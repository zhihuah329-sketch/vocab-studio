import json
import threading
import unittest
import urllib.request
import tempfile
from pathlib import Path
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app import make_handler, workbuddy_status


class FakeProvider(BaseHTTPRequestHandler):
    received = None

    def log_message(self, *_):
        pass

    def do_POST(self):
        size = int(self.headers["Content-Length"])
        FakeProvider.received = {"headers": dict(self.headers), "body": json.loads(self.rfile.read(size))}
        prompt = FakeProvider.received["body"]["messages"][0]["content"]
        if "exam-style" in prompt:
            content = {"title": "A Journey", "passage": "An original reading passage.", "translation": "一篇原创阅读文章。", "questions": [{"stem": f"Question {i}?", "options": ["One", "Two", "Three", "Four"], "answer": "A", "explanation": "文章支持 A。"} for i in range(5)]}
        elif "translation exercise" in prompt:
            content = {"title": "Translation", "items": [{"source": f"句子 {i}", "reference": f"Sentence {i}", "note": "注意句型。"} for i in range(5)]}
        elif "vocabulary list" in prompt:
            content = {"title": "旅行词汇", "items": [{"word": f"term{chr(97 + i)}", "meaning": "释义", "example": f"This is term {i}."} for i in range(20)]}
        elif "selected English word" in prompt:
            content = {"translation": "一次旅程", "note": "journey 表示旅行经历。"}
        else:
            content = {"title": "A Journey", "passage": "A curious journey revealed a secret.", "translation": "一次好奇的旅程揭示了秘密。"}
        body = json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ApiTests(unittest.TestCase):
    def test_buddy_detection_uses_v1_not_html_health_page(self):
        class BuddyProvider(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path == "/v1":
                    body = {"object": "api", "message": "Buddy Desktop"}
                elif self.path == "/v1/models":
                    body = {"object": "list", "data": [{"id": "deepseek-test"}]}
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"<html>not json</html>")
                    return
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        provider = ThreadingHTTPServer(("127.0.0.1", 0), BuddyProvider)
        thread = threading.Thread(target=provider.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict("os.environ", {"BUDDY_DESKTOP_PORT": str(provider.server_address[1])}):
                result = workbuddy_status()
            self.assertTrue(result["available"])
            self.assertEqual(result["models"], ["deepseek-test"])
        finally:
            provider.shutdown()
            provider.server_close()

    def test_import_and_generate_with_custom_url_without_key(self):
        provider = ThreadingHTTPServer(("127.0.0.1", 0), FakeProvider)
        app = ThreadingHTTPServer(("127.0.0.1", 0), make_handler("test-token"))
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (provider, app)]
        for thread in threads:
            thread.start()
        base = f"http://127.0.0.1:{app.server_address[1]}"

        def post(path, body, headers):
            request = urllib.request.Request(base + path, data=body, headers={"X-App-Token": "test-token", **headers}, method="POST")
            with urllib.request.urlopen(request) as response:
                return json.load(response)

        try:
            imported = post("/api/parse", b"word,meaning\ncurious,one\njourney,two", {"X-Filename": "words.csv"})
            self.assertEqual(imported["words"], ["curious", "journey"])
            generated = post("/api/generate", json.dumps({
                "api_url": f"http://127.0.0.1:{provider.server_address[1]}/v1/chat/completions",
                "model": "custom-model", "api_key": "", "words": imported["words"],
                "level": "B1", "length": 250, "topic": "travel"
            }).encode(), {"Content-Type": "application/json"})
            self.assertEqual(generated["missing"], [])
            self.assertEqual(FakeProvider.received["body"]["model"], "custom-model")
            self.assertNotIn("Authorization", FakeProvider.received["headers"])
            common = {"api_url": f"http://127.0.0.1:{provider.server_address[1]}/v1/chat/completions", "model": "custom-model", "api_key": "", "words": []}
            exam = post("/api/exam", json.dumps({**common, "exam": "英语四级", "topic": "travel"}).encode(), {"Content-Type": "application/json"})
            self.assertEqual(len(exam["questions"]), 5)
            exercise = post("/api/translation", json.dumps({**common, "direction": "zh-en", "level": "B1", "topic": "travel"}).encode(), {"Content-Type": "application/json"})
            self.assertEqual(len(exercise["items"]), 5)
            vocabulary = post("/api/vocabulary", json.dumps({**common, "level": "B1", "count": 20, "topic": "travel"}).encode(), {"Content-Type": "application/json"})
            self.assertEqual(len(vocabulary["items"]), 20)
            selected = post("/api/translate-selection", json.dumps({**common, "text": "a journey", "context": "A journey begins."}).encode(), {"Content-Type": "application/json"})
            self.assertEqual(selected["translation"], "一次旅程")
        finally:
            for server in (provider, app):
                server.shutdown()
                server.server_close()

    def test_settings_persist_without_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            app = ThreadingHTTPServer(("127.0.0.1", 0), make_handler("test-token", path))
            thread = threading.Thread(target=app.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{app.server_address[1]}"
            try:
                body = json.dumps({"api_url": "http://127.0.0.1:5178/v1/chat/completions", "model": "buddy-model", "theme": "dark", "api_key": "do-not-store"}).encode()
                request = urllib.request.Request(base + "/api/settings", data=body, headers={"X-App-Token": "test-token"}, method="POST")
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["theme"], "dark")
                self.assertNotIn("do-not-store", path.read_text(encoding="utf-8"))
                request = urllib.request.Request(base + "/api/settings", headers={"X-App-Token": "test-token"})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["model"], "buddy-model")
            finally:
                app.shutdown()
                app.server_close()

    def test_offline_books_and_study_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            study_path = Path(directory) / "study.json"
            app = ThreadingHTTPServer(("127.0.0.1", 0), make_handler("test-token", study_path=study_path))
            thread = threading.Thread(target=app.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{app.server_address[1]}"
            headers = {"X-App-Token": "test-token"}
            try:
                with urllib.request.urlopen(urllib.request.Request(base + "/api/books", headers=headers)) as response:
                    books = json.load(response)
                self.assertGreaterEqual(len(books["books"]), 5)
                with urllib.request.urlopen(urllib.request.Request(base + "/api/book?id=cet4", headers=headers)) as response:
                    book = json.load(response)
                self.assertGreater(len(book["items"]), 3000)
                state = {"custom": [{"word": "Journey", "meaning": "旅行"}], "progress": {"custom:journey": {"box": 1, "due": "2026-10-25", "seen": 1, "firstSeen": "2026-10-24"}}, "activeBook": "custom", "plans": {"custom": {"newPerDay": 12, "reviewPerDay": 25}}, "daily": {"2026-10-24": {"custom": {"new": ["journey"], "review": []}}}}
                request = urllib.request.Request(base + "/api/study", data=json.dumps(state).encode(), headers=headers, method="POST")
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["custom"][0]["word"], "journey")
                with urllib.request.urlopen(urllib.request.Request(base + "/api/study", headers=headers)) as response:
                    saved = json.load(response)
                    self.assertEqual(saved["progress"]["custom:journey"]["box"], 1)
                    self.assertEqual(saved["plans"]["custom"], {"newPerDay": 12, "reviewPerDay": 25})
                    self.assertEqual(saved["daily"]["2026-10-24"]["custom"]["new"], ["journey"])
            finally:
                app.shutdown()
                app.server_close()


if __name__ == "__main__":
    unittest.main()
