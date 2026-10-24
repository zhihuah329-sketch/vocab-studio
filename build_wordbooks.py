"""Create compact offline wordbooks from the MIT-licensed ECDICT CSV."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from core import normalize_word


SOURCE = Path("ecdict.csv")
DESTINATION = Path("data/wordbooks.json")
TITLES = {
    "zk": "中考核心词汇",
    "gk": "高考词汇",
    "cet4": "大学英语四级",
    "cet6": "大学英语六级",
    "ky": "考研英语",
    "ielts": "雅思词汇",
    "gre": "GRE 词汇",
}


def rank(value: str) -> int:
    try:
        number = int(value)
        return number if number > 0 else 999999
    except ValueError:
        return 999999


def main() -> None:
    books = {key: {} for key in TITLES}
    with SOURCE.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            word = normalize_word(row["word"])
            if not word:
                continue
            meaning = re.split(r"\\[rn]|[\r\n]", row["translation"] or "", maxsplit=1)[0].strip()
            if not meaning or not re.search(r"[\u3400-\u9fff]", meaning):
                continue
            item = {
                "word": word,
                "meaning": meaning[:150],
                "phonetic": (row["phonetic"] or "").strip()[:80],
            }
            priority = (rank(row["frq"]), rank(row["bnc"]), word)
            for key in set((row["tag"] or "").split()) & TITLES.keys():
                if word not in books[key]:
                    books[key][word] = (priority, item)
    result = {
        "source": "ECDICT",
        "source_url": "https://github.com/skywind3000/ECDICT",
        "license": "MIT; see ECDICT_LICENSE.txt",
        "books": [
            {
                "id": key,
                "title": title,
                "items": [item for _, item in sorted(books[key].values(), key=lambda entry: entry[0])],
            }
            for key, title in TITLES.items()
        ],
    }
    DESTINATION.parent.mkdir(exist_ok=True)
    DESTINATION.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print({book["id"]: len(book["items"]) for book in result["books"]})
    print(f"Wrote {DESTINATION} ({DESTINATION.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
