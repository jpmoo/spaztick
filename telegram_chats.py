"""
Persisted set of Telegram chat IDs that have messaged the bot and passed the whitelist.
Used by the cron scheduler to send list digests to all known (whitelisted) users.
Both the Telegram bot process and the main process (cron) read/write the same file.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_KNOWN_CHATS_PATH = Path(__file__).resolve().parent / "telegram_known_chats.json"


def get_known_chat_ids() -> list[int]:
    """Return list of chat IDs that have messaged the bot and were allowed (whitelist)."""
    if not _KNOWN_CHATS_PATH.exists():
        return []
    try:
        raw = _KNOWN_CHATS_PATH.read_text()
        data = json.loads(raw) if raw.strip() else {}
        ids = data.get("chat_ids") or []
        return [int(x) for x in ids if x is not None and str(x).strip().lstrip("-").isdigit()]
    except Exception as e:
        logger.warning("Could not read telegram_known_chats.json: %s", e)
        return []


def add_known_chat(chat_id: int) -> None:
    """Record a chat_id so cron can send list digests to this user. Idempotent."""
    try:
        ids = get_known_chat_ids()
        if chat_id in ids:
            return
        ids.append(chat_id)
        ids.sort()
        _KNOWN_CHATS_PATH.write_text(json.dumps({"chat_ids": ids}, indent=0))
    except Exception as e:
        logger.warning("Could not save telegram_known_chats.json: %s", e)
