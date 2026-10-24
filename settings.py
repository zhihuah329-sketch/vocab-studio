"""Small, credential-free preferences shared across app launches."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse


DEFAULTS = {
    "api_url": "http://127.0.0.1:5178/v1/chat/completions",
    "model": "",
    "theme": "light",
    "nickname": "",
}


def default_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".config")
    return base / "VocabStudio" / "settings.json"


def read_settings(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return DEFAULTS.copy()
    if not isinstance(data, dict):
        return DEFAULTS.copy()
    result = DEFAULTS.copy()
    for key in result:
        if isinstance(data.get(key), str):
            result[key] = data[key]
    return result


def save_settings(path: Path, data: dict) -> dict:
    api_url = str(data.get("api_url", "")).strip()
    parsed = urlparse(api_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("请输入有效的 HTTP(S) API URL。")
    model = str(data.get("model", "")).strip()
    if len(api_url) > 2048 or len(model) > 200:
        raise ValueError("接口配置过长。")
    theme = data.get("theme")
    if theme not in {"light", "dark"}:
        raise ValueError("主题设置无效。")
    nickname = str(data.get("nickname") or "").strip()
    if len(nickname) > 30:
        raise ValueError("昵称最多 30 个字符。")
    result = {"api_url": api_url, "model": model, "theme": theme, "nickname": nickname}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    return result
