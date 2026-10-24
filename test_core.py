import tempfile
import unittest
import io
import json
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from core import generate_passage, generate_writing_prompt, grade_writing, load_words, load_words_bytes, missing_words, parse_text


class WordlistTests(unittest.TestCase):
    def test_writing_prompt_uses_exam_level_and_word_range(self):
        with patch("core.chat_json", return_value={"title": "科技与生活", "prompt": "谈谈科技。", "requirements": "举例说明。"}) as send:
            result = generate_writing_prompt("http://localhost", "test", "", "英语四级", "科技", ["technology"])
        self.assertEqual((result["min_words"], result["max_words"]), (120, 180))
        self.assertEqual(send.call_args.args[-1]["level"], "英语四级")
        with self.assertRaises(ValueError):
            generate_writing_prompt("http://localhost", "test", "", "A2", "", [])

    def test_writing_grade_validates_score_and_quotes(self):
        essay = "I enjoy reading books because they help me learn about the world. Reading every evening also gives me new ideas for school and daily life."
        feedback = {"score": 82, "criteria": {"content": 22, "organization": 20, "language": 21, "accuracy": 19},
                    "summary": "内容清楚。", "strengths": ["例子具体"],
                    "issues": [{"original": "Reading every evening", "correction": "Reading each evening", "reason": "表达更自然。"}],
                    "revised_essay": essay}
        with patch("core.chat_json", return_value=feedback):
            result = grade_writing("http://localhost", "test", "", "英语四级", "谈阅读习惯。", essay)
        self.assertEqual(result["score"], 82)
        self.assertGreater(result["word_count"], 20)
        with patch("core.chat_json", return_value={**feedback, "score": 90}):
            with self.assertRaises(RuntimeError):
                grade_writing("http://localhost", "test", "", "英语四级", "谈阅读习惯。", essay)

    def test_csv_tsv_and_deduplication(self):
        text = "\ufeffword,meaning\nCurious,好奇\nJourney,旅行\ncurious,重复\n2. Discover,发现"
        self.assertEqual(parse_text(text), ["curious", "journey", "discover"])
        self.assertEqual(parse_text("word\tmeaning\nbridge\t桥\nriver\t河"), ["bridge", "river"])

    def test_excel_first_column(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "words.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["单词", "释义"])
            sheet.append(["Explore", "探索"])
            sheet.append(["explore", "重复"])
            workbook.save(path)
            self.assertEqual(load_words(path), ["explore"])

    def test_coverage_requires_whole_word(self):
        self.assertEqual(missing_words("A curious traveler discovered a place.", ["curious", "cover", "place"]), ["cover"])

    def test_custom_endpoint_without_key_or_word_limit(self):
        words = [f"word{i}" for i in range(30)]
        response = {"choices": [{"message": {"content": json.dumps({"title": "Trip", "passage": "word0 travels.", "translation": "旅行。"})}}]}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as mocked:
            result = generate_passage("http://127.0.0.1:11434/v1/chat/completions", "local-model", "", words, "B1", 250, "")
        request = mocked.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/v1/chat/completions")
        self.assertNotIn("Authorization", request.headers)
        self.assertEqual(json.loads(request.data)["model"], "local-model")
        self.assertEqual(result["title"], "Trip")

    def test_parse_uploaded_bytes(self):
        self.assertEqual(load_words_bytes("words.csv", "word,meaning\nBridge,桥".encode()), ["bridge"])


if __name__ == "__main__":
    unittest.main()
