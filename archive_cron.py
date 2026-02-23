"""
Archive completed tasks into the archived table on a cron schedule.
Uses config.archive_cron (5-field: min hour day month weekday) in user_timezone.
Called from the same scheduler loop as telegram_cron (run.py / telegram_cron).
When tasks are archived, sends a Telegram message with the list (same format as list digests).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

try:
    from croniter import croniter
except ImportError:
    croniter = None

logger = logging.getLogger(__name__)


def run_archive_completed_tasks() -> tuple[int, list[dict]]:
    """
    Move all completed tasks from tasks to archived (same columns + archived_at).
    Returns (number_archived, list of task dicts that were archived, for Telegram).
    """
    from database import get_connection
    from task_service import _task_row_to_dict
    conn = get_connection()
    try:
        # Fetch completed tasks before moving (for Telegram message)
        rows = conn.execute("SELECT * FROM tasks WHERE status = 'complete'").fetchall()
        tasks = [_task_row_to_dict(r) for r in rows]
        archived_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            """
            INSERT INTO archived (
                id, number, title, description, notes, status, priority,
                available_date, due_date, recurrence, recurrence_parent_id,
                created_at, updated_at, completed_at, flagged, archived_at
            )
            SELECT
                id, number, title, description, notes, status, priority,
                available_date, due_date, recurrence, recurrence_parent_id,
                created_at, updated_at, completed_at, flagged, ?
            FROM tasks
            WHERE status = 'complete'
            """,
            (archived_at,),
        )
        count = conn.total_changes
        # task_history has no ON DELETE CASCADE; remove history for completed tasks first
        conn.execute(
            "DELETE FROM task_history WHERE task_id IN (SELECT id FROM tasks WHERE status = 'complete')"
        )
        conn.execute("DELETE FROM tasks WHERE status = 'complete'")
        conn.commit()
        if count > 0:
            logger.info("Archived %d completed task(s) to archived table.", count)
        return (count, tasks)
    finally:
        conn.close()


def run_archive_if_due() -> None:
    """If config.archive_cron is set and the current time matches, run the archive job."""
    if not croniter:
        return
    try:
        from config import load as load_config
        config = load_config()
    except Exception as e:
        logger.debug("Could not load config for archive cron: %s", e)
        return
    cron_expr = (getattr(config, "archive_cron", "") or "").strip()
    if not cron_expr:
        return
    if not croniter.is_valid(cron_expr):
        logger.warning("Invalid archive_cron expression: %s", cron_expr)
        return
    tz_name = (getattr(config, "user_timezone", "") or "UTC").strip() or "UTC"
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc
    now = datetime.now(tz)
    try:
        if not croniter.match(cron_expr, now):
            return
    except Exception as e:
        logger.warning("Archive cron match failed for %s: %s", cron_expr, e)
        return
    try:
        count, archived_tasks = run_archive_completed_tasks()
    except Exception as e:
        logger.exception("Archive completed tasks failed: %s", e)
        return
    _send_archive_digest_to_telegram(config, tz_name, count, archived_tasks or [])


def _send_archive_digest_to_telegram(config: Any, tz_name: str, count: int, tasks: list[dict]) -> None:
    """Send the archive digest to Telegram (task list or 'No completed tasks to archive')."""
    token = (getattr(config, "telegram_bot_token", "") or "").strip()
    if not token:
        return
    configured_chat = (getattr(config, "telegram_cron_chat_id", "") or "").strip()
    if configured_chat:
        chat_ids = [configured_chat]
    else:
        try:
            from telegram_chats import get_known_chat_ids
            chat_ids = [str(cid) for cid in get_known_chat_ids()]
        except Exception as e:
            logger.debug("Could not load known Telegram chats for archive digest: %s", e)
            chat_ids = []
    if not chat_ids:
        return
    try:
        from telegram_cron import _send_telegram_message
    except ImportError as e:
        logger.warning("Could not import Telegram send: %s", e)
        return
    if count == 0 or not tasks:
        text = "*Archive run*\n\nNo completed tasks to archive."
    else:
        try:
            from orchestrator import _format_task_list_for_telegram
        except ImportError as e:
            logger.warning("Could not import formatter: %s", e)
            text = f"*Archived {count} completed task(s)*\n\n(List formatting unavailable.)"
        else:
            header = f"*Archived {count} completed task(s)*\n\n"
            body = _format_task_list_for_telegram(tasks, max_show=50, tz_name=tz_name)
            if body.startswith("*Tasks (") and "\n" in body:
                body = body.split("\n", 1)[1]
            text = header + body
    for cid in chat_ids:
        if _send_telegram_message(token, cid, text, parse_mode="Markdown"):
            logger.info("Sent archive digest to Telegram chat_id=%s", cid)
        else:
            logger.warning("Failed to send archive digest to Telegram chat_id=%s", cid)
