import json
import tempfile
import unittest
from pathlib import Path

from settings import read_settings, save_settings
from study import read_study, save_study


class ProfileDataTests(unittest.TestCase):
    def test_old_study_file_without_activity_upgrades(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "study.json"
            # Shape written by v4.0.x, before practice history existed.
            path.write_text(json.dumps({"custom": [], "progress": {"cet4:apple": {"box": 2, "due": "2026-10-25", "seen": 3, "firstSeen": "2026-10-20"}}, "activeBook": "cet4", "plans": {}, "daily": {}}), encoding="utf-8")
            state = read_study(path)
            self.assertEqual(state["activity"], [])
            self.assertEqual(state["progress"]["cet4:apple"]["box"], 2)

    def test_activity_is_validated_and_persisted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "study.json"
            activity = [
                {"kind": "exam", "title": "A test", "at": "2026-10-24T05:00:00.000Z", "score": 4},
                {"kind": "story", "title": "x" * 300, "at": "2026-10-24T06:00:00.000Z", "score": True},
                {"kind": "unknown", "title": "drop", "at": "2026-10-24T06:00:00.000Z"},
                {"kind": "translation", "title": "no date"},
            ]
            saved = save_study(path, {"custom": [], "progress": {}, "activity": activity})
            self.assertEqual([item["kind"] for item in saved["activity"]], ["exam", "story"])
            self.assertEqual(saved["activity"][0]["score"], 4)
            self.assertNotIn("score", saved["activity"][1])
            self.assertEqual(len(saved["activity"][1]["title"]), 120)
            self.assertEqual(read_study(path)["activity"], saved["activity"])

    def test_activity_keeps_latest_500(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "study.json"
            activity = [{"kind": "story", "title": str(i), "at": "2026-10-24T06:00:00Z"} for i in range(600)]
            saved = save_study(path, {"custom": [], "progress": {}, "activity": activity})
            self.assertEqual(len(saved["activity"]), 500)
            self.assertEqual(saved["activity"][-1]["title"], "599")

    def test_nickname_saved_and_old_settings_default(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text(json.dumps({"api_url": "http://127.0.0.1:5178/v1/chat/completions", "model": "m", "theme": "dark"}), encoding="utf-8")
            self.assertEqual(read_settings(path)["nickname"], "")
            saved = save_settings(path, {"api_url": "http://127.0.0.1:5178/v1/chat/completions", "model": "m", "theme": "dark", "nickname": "  小明 "})
            self.assertEqual(saved["nickname"], "小明")
            self.assertEqual(read_settings(path)["nickname"], "小明")
            with self.assertRaises(ValueError):
                save_settings(path, {"api_url": "http://127.0.0.1:5178/v1/chat/completions", "model": "m", "theme": "dark", "nickname": "n" * 31})


if __name__ == "__main__":
    unittest.main()
