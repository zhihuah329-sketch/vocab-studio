"""Launch the local reading studio in a desktop WebView2 window."""

from __future__ import annotations

import json
import os
import secrets
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import webview

from core import generate_exam, generate_passage, generate_translation, generate_vocabulary, generate_writing_prompt, grade_writing, load_words_bytes, missing_words, translate_selection
from export_docx import build_reading_docx
from settings import default_path, read_settings, save_settings
from study import default_study_path, get_book, list_books, read_study, save_study


ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB = ROOT / "web"
BOOKS = ROOT / "data" / "wordbooks.json"
MAX_BODY = 8 * 1024 * 1024
MIME = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}
_buddy_process: subprocess.Popen | None = None


class DesktopApi:
    def __init__(self):
        self.window = None

    def export_reading_word(self, payload: dict, filename: str) -> dict:
        if self.window is None:
            raise RuntimeError("桌面窗口尚未准备好。")
        if filename not in {"阅读短文.docx", "等级考试阅读.docx"}:
            raise ValueError("无效的导出文件名。")
        document = build_reading_docx(payload)
        selection = self.window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=filename,
            file_types=("Word 文档 (*.docx)",),
        )
        if not selection:
            return {"saved": False}
        path = Path(selection[0] if isinstance(selection, (tuple, list)) else selection)
        if path.suffix.lower() != ".docx":
            path = path.with_suffix(".docx")
        path.write_bytes(document)
        return {"saved": True, "path": str(path)}


def workbuddy_status() -> dict:
    try:
        port = int(os.environ.get("BUDDY_DESKTOP_PORT", "5178"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        port = 5178
    base = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(base + "/v1", timeout=3) as response:
            info = json.load(response)
        with urllib.request.urlopen(base + "/v1/models", timeout=3) as response:
            listing = json.load(response)
        if not isinstance(info, dict) or info.get("message") != "Buddy Desktop" or not isinstance(listing, dict) or not isinstance(listing.get("data"), list):
            raise ValueError("端口响应不是 Buddy Desktop 模型接口")
        models = [item["id"] for item in listing.get("data", []) if isinstance(item, dict) and isinstance(item.get("id"), str)]
        return {"available": True, "api_url": base + "/v1/chat/completions", "models": models}
    except (OSError, ValueError, urllib.error.URLError) as exc:
        return {"available": False, "api_url": base + "/v1/chat/completions", "models": [], "message": f"无法识别 Buddy Desktop 本机接口（{port} 端口）：{exc}"}


def start_workbuddy() -> dict:
    global _buddy_process
    status = workbuddy_status()
    if status["available"]:
        return status
    if _buddy_process and _buddy_process.poll() is None:
        return {"starting": True, "message": "Buddy 本机代理正在后台启动。"}
    install_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "BuddyDesktop"
    executable = install_dir / "electron.exe"
    cli = install_dir / "resources" / "app" / "node_modules" / "@buddy-desktop" / "server" / "src" / "cli.js"
    if not executable.is_file() or not cli.is_file():
        raise ValueError("未找到 Buddy 本机代理。请先安装并登录 Buddy Desktop。")
    try:
        port = int(os.environ.get("BUDDY_DESKTOP_PORT", "5178"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        port = 5178
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    startup = subprocess.STARTUPINFO() if os.name == "nt" else None
    if startup:
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
    environment = os.environ.copy()
    environment["ELECTRON_RUN_AS_NODE"] = "1"
    _buddy_process = subprocess.Popen(
        [str(executable), str(cli), "--port", str(port), "--host", "127.0.0.1"],
        cwd=str(cli.parent), env=environment, creationflags=flags,
        startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return {"starting": True, "message": "Buddy 本机代理正在后台启动，无需打开 Buddy 主窗口。"}


def dictionary_entry(word: str) -> dict:
    if not re.fullmatch(r"[A-Za-z][A-Za-z' -]{0,79}", word):
        raise ValueError("单词格式无效。")
    url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + quote(word)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "VocabStudio/4.2"}), timeout=8) as response:
            entries = json.load(response)
    except (OSError, ValueError, urllib.error.HTTPError):
        return {"phonetic": "", "example": "", "audio": ""}
    if not isinstance(entries, list) or not entries:
        return {"phonetic": "", "example": "", "audio": ""}
    entry = entries[0]
    phonetics = entry.get("phonetics") or []
    audio = next((item.get("audio", "") for item in phonetics if isinstance(item, dict) and item.get("audio")), "")
    if audio.startswith("//"):
        audio = "https:" + audio
    if not audio.startswith("https://"):
        audio = ""
    example = next((definition.get("example", "") for meaning in entry.get("meanings", []) for definition in meaning.get("definitions", []) if isinstance(definition, dict) and definition.get("example")), "")
    return {"phonetic": str(entry.get("phonetic") or next((item.get("text", "") for item in phonetics if isinstance(item, dict) and item.get("text")), ""))[:80], "example": str(example)[:300], "audio": audio}


def make_handler(token: str, settings_path: Path | None = None, study_path: Path | None = None, books_path: Path | None = None):
    preferences = settings_path or default_path()
    study_file = study_path or default_study_path()
    books_file = books_path or BOOKS
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            route = parsed.path
            if route in {"/api/settings", "/api/workbuddy", "/api/books", "/api/book", "/api/study", "/api/dictionary"}:
                if self.headers.get("X-App-Token") != token:
                    self._json(403, {"error": "请求未授权。"})
                else:
                    try:
                        if route == "/api/settings":
                            result = read_settings(preferences)
                        elif route == "/api/workbuddy":
                            result = workbuddy_status()
                        elif route == "/api/books":
                            result = list_books(books_file)
                        elif route == "/api/book":
                            result = get_book(books_file, parse_qs(parsed.query).get("id", [""])[0])
                        elif route == "/api/dictionary":
                            result = dictionary_entry(parse_qs(parsed.query).get("word", [""])[0])
                        else:
                            result = read_study(study_file)
                        self._json(200, result)
                    except (OSError, ValueError) as exc:
                        self._json(400, {"error": str(exc)})
                return
            filename = "index.html" if route == "/" else route.lstrip("/")
            if filename not in {"index.html", "style.css", "additions.css", "app.js"}:
                self.send_error(404)
                return
            path = WEB / filename
            try:
                data = path.read_bytes()
            except OSError:
                self.send_error(404)
                return
            if filename == "index.html":
                data = data.replace(b"__APP_TOKEN__", token.encode("ascii"))
            self.send_response(200)
            self.send_header("Content-Type", MIME[path.suffix] + "; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if self.headers.get("X-App-Token") != token:
                self._json(403, {"error": "请求未授权。"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 0 < size <= MAX_BODY:
                self._json(413, {"error": "文件或请求过大，限制为 8 MB。"})
                return
            body = self.rfile.read(size)
            try:
                if self.path == "/api/parse":
                    filename = self.headers.get("X-Filename", "words.txt")
                    words = load_words_bytes(filename, body)
                    self._json(200, {"words": words})
                elif self.path == "/api/export/docx":
                    document = build_reading_docx(json.loads(body))
                    self.send_response(200)
                    self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                    self.send_header("Content-Disposition", 'attachment; filename="VocabStudio-Reading.docx"')
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", str(len(document)))
                    self.end_headers()
                    self.wfile.write(document)
                elif self.path == "/api/generate":
                    data = json.loads(body)
                    words = data.get("words", [])
                    if not isinstance(words, list) or not all(isinstance(word, str) for word in words):
                        raise ValueError("单词列表格式有误。")
                    result = generate_passage(
                        str(data.get("api_url", "")), str(data.get("model", "")),
                        str(data.get("api_key", "")), words,
                        str(data.get("level", "B1")), int(data.get("length", 250)),
                        str(data.get("topic", "")),
                    )
                    result["missing"] = missing_words(result["passage"], words)
                    self._json(200, result)
                elif self.path == "/api/settings":
                    self._json(200, save_settings(preferences, json.loads(body)))
                elif self.path == "/api/study":
                    self._json(200, save_study(study_file, json.loads(body)))
                elif self.path == "/api/workbuddy/start":
                    self._json(200, start_workbuddy())
                elif self.path == "/api/vocabulary":
                    data = json.loads(body)
                    result = generate_vocabulary(
                        str(data.get("api_url", "")), str(data.get("model", "")),
                        str(data.get("api_key", "")), str(data.get("level", "")),
                        int(data.get("count", 20)), str(data.get("topic", "")),
                    )
                    self._json(200, result)
                elif self.path == "/api/writing/prompt":
                    data = json.loads(body)
                    result = generate_writing_prompt(
                        str(data.get("api_url", "")), str(data.get("model", "")),
                        str(data.get("api_key", "")), str(data.get("level", "")),
                        str(data.get("topic", "")), data.get("words", []),
                    )
                    self._json(200, result)
                elif self.path == "/api/writing/grade":
                    data = json.loads(body)
                    result = grade_writing(
                        str(data.get("api_url", "")), str(data.get("model", "")),
                        str(data.get("api_key", "")), str(data.get("level", "")),
                        str(data.get("task", "")), str(data.get("essay", "")),
                    )
                    self._json(200, result)
                elif self.path == "/api/translate-selection":
                    data = json.loads(body)
                    result = translate_selection(
                        str(data.get("api_url", "")), str(data.get("model", "")),
                        str(data.get("api_key", "")), str(data.get("text", "")),
                        str(data.get("context", "")),
                    )
                    self._json(200, result)
                elif self.path in {"/api/exam", "/api/translation"}:
                    data = json.loads(body)
                    words = data.get("words", [])
                    if not isinstance(words, list) or not all(isinstance(word, str) for word in words):
                        raise ValueError("单词列表格式有误。")
                    common = (str(data.get("api_url", "")), str(data.get("model", "")), str(data.get("api_key", "")))
                    if self.path == "/api/exam":
                        result = generate_exam(*common, str(data.get("exam", "")), str(data.get("topic", "")), words)
                    else:
                        result = generate_translation(*common, str(data.get("direction", "")), str(data.get("level", "")), str(data.get("topic", "")), words)
                    self._json(200, result)
                else:
                    self._json(404, {"error": "接口不存在。"})
            except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
                self._json(400, {"error": str(exc)})

        def _json(self, status: int, value: dict):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def main():
    token = secrets.token_urlsafe(24)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(token))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    try:
        desktop_api = DesktopApi()
        window = webview.create_window("词页 · 英语练习工作台", url, width=1280, height=820, min_size=(760, 560), background_color="#f7f8f4", js_api=desktop_api)
        desktop_api.window = window
        webview.start(gui="edgechromium")
    finally:
        server.shutdown()
        server.server_close()
        if _buddy_process and _buddy_process.poll() is None:
            _buddy_process.terminate()


if __name__ == "__main__":
    main()
