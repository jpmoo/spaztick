"""
Scheduled list delivery via Telegram: run list query and send result to a configured chat.
Uses cron notation (5-field: min hour day month weekday) in user_timezone.
Start the scheduler from the main process (e.g. run.py or web_app startup).
"""
from __future__ import annotations

import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any

try:
    from croniter import croniter
except ImportError:
    croniter = None

logger = logging.getLogger(__name__)

_scheduler_thread: threading.Thread | None = None
_stop_event: threading.Event | None = None


def _send_telegram_message(token: str, chat_id: str, text: str, parse_mode: str | None = None) -> bool:
    """Send a text message via Telegram Bot API. Returns True on success. Use parse_mode='Markdown' for diff/code blocks."""
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {"chat_id": chat_id.strip(), "text": text}
    if parse_mode:
        data["parse_mode"] = parse_mode
    try:
        req = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(data).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status in (200, 201):
                return True
            logger.warning("Telegram sendMessage returned %s", resp.status)
            return False
    except urllib.error.HTTPError as e:
        logger.warning("Telegram sendMessage HTTP error: %s %s", e.code, e.reason)
        return False
    except Exception as e:
        logger.warning("Telegram sendMessage failed: %s", e)
        return False


def _run_due_list_sends() -> None:
    """Check which lists are due by cron and send them to Telegram."""
    if not croniter:
        return
    try:
        from config import load as load_config
        config = load_config()
    except Exception as e:
        logger.debug("Could not load config for telegram cron: %s", e)
        return
    token = (getattr(config, "telegram_bot_token", "") or "").strip()
    if not token:
        return
    # Send to configured chat ID if set, otherwise to all known (whitelisted) users who have messaged the bot
    configured_chat = (getattr(config, "telegram_cron_chat_id", "") or "").strip()
    if configured_chat:
        chat_ids = [configured_chat]
    else:
        try:
            from telegram_chats import get_known_chat_ids
            chat_ids = [str(cid) for cid in get_known_chat_ids()]
        except Exception as e:
            logger.debug("Could not load known Telegram chats: %s", e)
            chat_ids = []
    if not chat_ids:
        return
    tz_name = (getattr(config, "user_timezone", "") or "UTC").strip() or "UTC"
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:
        from datetime import timezone
        tz = timezone.utc
    now = datetime.now(tz)
    try:
        from list_service import get_lists_with_telegram_cron, get_list, run_list
    except ImportError as e:
        logger.debug("List service not available for telegram cron: %s", e)
        return
    lists = get_lists_with_telegram_cron()
    for lst in lists:
        cron_expr = (lst.get("telegram_send_cron") or "").strip()
        if not cron_expr:
            continue
        if not croniter.is_valid(cron_expr):
            logger.warning("Invalid cron expression for list %s: %s", lst.get("id"), cron_expr)
            continue
        try:
            if not croniter.match(cron_expr, now):
                continue
        except Exception as e:
            logger.warning("Cron match failed for list %s expr %s: %s", lst.get("id"), cron_expr, e)
            continue
        list_id = lst.get("id") or lst.get("short_id")
        if not list_id:
            continue
        try:
            tasks = run_list(list_id, limit=500, tz_name=tz_name)
        except Exception as e:
            logger.warning("Run list %s failed: %s", list_id, e)
            continue
        try:
            from orchestrator import _format_task_list_for_telegram
        except ImportError:
            logger.warning("Orchestrator not available for formatting list")
            continue
        list_label = (lst.get("name") or "").strip() or list_id
        short_id = (lst.get("short_id") or "").strip()
        if short_id:
            header = f"List: {list_label} ({short_id})\n"
        else:
            header = f"List: {list_label}\n"
        body = _format_task_list_for_telegram(tasks, 50, tz_name)
        text = header + body
        use_markdown = "```" in body
        for cid in chat_ids:
            if _send_telegram_message(token, cid, text, parse_mode="Markdown" if use_markdown else None):
                logger.info("Sent list %s to Telegram (cron) chat_id=%s", list_id, cid)
            else:
                logger.warning("Failed to send list %s to Telegram chat_id=%s", list_id, cid)


def _scheduler_loop() -> None:
    """Run every minute and send due lists."""
    while _stop_event and not _stop_event.is_set():
        try:
            _run_due_list_sends()
        except Exception as e:
            logger.warning("Telegram cron tick failed: %s", e)
        if _stop_event:
            _stop_event.wait(timeout=60)


def start_telegram_cron_scheduler() -> None:
    """Start the background thread that sends lists on cron schedule. Idempotent."""
    global _scheduler_thread, _stop_event
    if _scheduler_thread is not None and _scheduler_thread.is_alive():
        return
    if not croniter:
        logger.debug("croniter not installed; telegram list cron disabled")
        return
    _stop_event = threading.Event()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="telegram-cron")
    _scheduler_thread.start()
    logger.info("Telegram list cron scheduler started")


def stop_telegram_cron_scheduler() -> None:
    """Signal the scheduler thread to stop."""
    global _stop_event
    if _stop_event:
        _stop_event.set()
