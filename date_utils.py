"""
Resolve relative date strings ('today', 'tomorrow') to ISO dates (YYYY-MM-DD) in the user's timezone.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from zoneinfo import ZoneInfo

# Already ISO date
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today_in_tz(tz_name: str) -> date:
    name = (tz_name or "").strip() or "UTC"
    tz = ZoneInfo(name)
    return datetime.now(tz).date()


def resolve_relative_date(value: str | None, tz_name: str = "UTC") -> str | None:
    """
    Convert a date string to YYYY-MM-DD. Respects user timezone for relative phrases.
    - If value is already YYYY-MM-DD, return it.
    - If value is 'today', 'tomorrow', 'yesterday', 'next week', or 'in N days', return the resolved date.
    - Otherwise return None (caller can keep original or skip).
    """
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().lower()
    raw = re.sub(r"^(due|available)\s+", "", raw).strip()
    if _ISO_DATE.match(raw):
        return raw
    try:
        today = _today_in_tz((tz_name or "").strip() or "UTC")
    except Exception:
        today = date.today()
    if raw == "today":
        return today.isoformat()
    if raw == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if raw == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    if raw == "next week" or raw == "in a week":
        return (today + timedelta(days=7)).isoformat()
    # "in N days"
    m = re.match(r"^in\s+(\d+)\s+days?$", raw)
    if m:
        n = int(m.group(1))
        return (today + timedelta(days=n)).isoformat()
    # Day names: monday, tuesday, ... (next occurrence of that weekday)
    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    if raw in weekdays:
        target_weekday = weekdays.index(raw)  # 0=Monday
        current_weekday = today.weekday()  # 0=Monday
        days_ahead = (target_weekday - current_weekday) % 7
        if days_ahead == 0:
            days_ahead = 7  # "next" Monday if today is Monday
        return (today + timedelta(days=days_ahead)).isoformat()
    return None


def resolve_task_dates(
    params: dict[str, Any],
    tz_name: str = "UTC",
) -> dict[str, Any]:
    """Resolve available_date and due_date in task params; return a copy with resolved ISO dates where possible."""
    out = dict(params)
    for key in ("available_date", "due_date"):
        val = out.get(key)
        if val is None:
            continue
        resolved = resolve_relative_date(str(val).strip(), tz_name)
        if resolved is not None:
            out[key] = resolved
    return out
