"""Offline wordbooks and local flashcard progress."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from core import normalize_word

DEFAULT_PLAN = {"newPerDay": 20, "reviewPerDay": 40}
BOOK_IDS = {"custom", "zk", "gk", "cet4", "cet6", "ky", "ielts", "gre"}


def clean_plans(value: object) -> dict:
    plans = {}
    if not isinstance(value, dict):
        return plans
    for book_id, plan in value.items():
        if book_id not in BOOK_IDS or not isinstance(plan, dict):
            continue
        try:
            new_count = int(plan.get("newPerDay", 20))
            review_count = int(plan.get("reviewPerDay", 40))
        except (TypeError, ValueError):
            continue
        if 1 <= new_count <= 100 and 0 <= review_count <= 200:
            plans[book_id] = {"newPerDay": new_count, "reviewPerDay": review_count}
    return plans


def clean_daily(value: object) -> dict:
    daily = {}
    if not isinstance(value, dict):
        return daily
    for date, books in list(value.items())[-120:]:
        if not isinstance(date, str) or len(date) != 10 or not isinstance(books, dict):
            continue
        day = {}
        for book_id, counts in books.items():
            if book_id not in BOOK_IDS or not isinstance(counts, dict):
                continue
            day[book_id] = {}
            for kind in ("new", "review"):
                words = counts.get(kind, [])
                day[book_id][kind] = list(dict.fromkeys(
                    word for word in words[:200] if isinstance(word, str) and len(word) <= 100
                )) if isinstance(words, list) else []
        daily[date] = day
    return daily


@lru_cache(maxsize=1)
def load_books(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def list_books(path: Path) -> dict:
    data = load_books(path)
    return {
        "source": data["source"],
        "source_url": data["source_url"],
        "license": data["license"],
        "books": [{"id": book["id"], "title": book["title"], "count": len(book["items"])} for book in data["books"]],
    }


def get_book(path: Path, book_id: str) -> dict:
    for book in load_books(path)["books"]:
        if book["id"] == book_id:
            return book
    raise ValueError("找不到这本词书。")


def default_study_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".config")
    return base / "VocabStudio" / "study.json"


def read_study(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("custom"), list) and isinstance(data.get("progress"), dict):
            return {"custom": data["custom"], "progress": data["progress"], "activeBook": data.get("activeBook", "cet4"), "plans": clean_plans(data.get("plans")), "daily": clean_daily(data.get("daily"))}
    except (OSError, ValueError):
        pass
    return {"custom": [], "progress": {}, "activeBook": "cet4", "plans": {}, "daily": {}}


def save_study(path: Path, data: dict) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("custom"), list) or not isinstance(data.get("progress"), dict):
        raise ValueError("背词记录格式无效。")
    if len(data["custom"]) > 10000 or len(data["progress"]) > 50000:
        raise ValueError("背词记录过大。")
    custom = []
    seen = set()
    for item in data["custom"]:
        if not isinstance(item, dict):
            continue
        word = normalize_word(item.get("word"))
        if not word or word in seen:
            continue
        seen.add(word)
        custom.append({
            "word": word,
            "meaning": str(item.get("meaning") or "")[:200],
            "phonetic": str(item.get("phonetic") or "")[:80],
        })
    progress = {}
    for key, value in data["progress"].items():
        if not isinstance(key, str) or len(key) > 120 or not isinstance(value, dict):
            continue
        try:
            box = int(value.get("box", 0))
            seen_count = int(value.get("seen", 0))
        except (TypeError, ValueError):
            continue
        due = value.get("due", "")
        if not 0 <= box <= 5 or not 0 <= seen_count <= 100000 or not isinstance(due, str) or len(due) > 10:
            continue
        first_seen = value.get("firstSeen", "")
        progress[key] = {"box": box, "due": due, "seen": seen_count, "firstSeen": first_seen if isinstance(first_seen, str) and len(first_seen) == 10 else ""}
    active_book = data.get("activeBook", "cet4")
    if active_book not in BOOK_IDS:
        active_book = "cet4"
    result = {"custom": custom, "progress": progress, "activeBook": active_book, "plans": clean_plans(data.get("plans")), "daily": clean_daily(data.get("daily"))}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    return result
