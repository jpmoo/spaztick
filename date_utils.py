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


def resolve_date_expression(value: str | None, tz_name: str = "UTC") -> str | None:
    """
    Resolve list query date expressions to YYYY-MM-DD.
    Supports: "today", "today+3", "today-1", "tomorrow", "tomorrow+1", "tomorrow-1",
    "yesterday" (no spaces around +/-).
    Used by saved list AST compilation.
    """
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().lower()
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
    m = re.match(r"^today\+(\d+)$", raw)
    if m:
        return (today + timedelta(days=int(m.group(1)))).isoformat()
    m = re.match(r"^today-(\d+)$", raw)
    if m:
        return (today - timedelta(days=int(m.group(1)))).isoformat()
    m = re.match(r"^tomorrow\+(\d+)$", raw)
    if m:
        return (today + timedelta(days=1 + int(m.group(1)))).isoformat()
    m = re.match(r"^tomorrow-(\d+)$", raw)
    if m:
        return (today + timedelta(days=1 - int(m.group(1)))).isoformat()
    m = re.match(r"^yesterday\+(\d+)$", raw)
    if m:
        return (today - timedelta(days=1 - int(m.group(1)))).isoformat()
    m = re.match(r"^yesterday-(\d+)$", raw)
    if m:
        return (today - timedelta(days=1 + int(m.group(1)))).isoformat()
    return None


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


def format_date_friendly(iso_date: str | None, tz_name: str = "UTC") -> str:
    """
    Format an ISO date (YYYY-MM-DD) for display in chat/Telegram: "today", "yesterday", "tomorrow", or "m/d".
    """
    if not iso_date or not _ISO_DATE.match(str(iso_date).strip()):
        return str(iso_date or "")
    try:
        today = _today_in_tz((tz_name or "").strip() or "UTC")
    except Exception:
        today = date.today()
    y, m, d = iso_date[:10].split("-")
    d_date = date(int(y), int(m), int(d))
    if d_date == today:
        return "today"
    if d_date == today + timedelta(days=1):
        return "tomorrow"
    if d_date == today - timedelta(days=1):
        return "yesterday"
    return f"{int(m)}/{int(d)}"


def format_datetime_info(iso_datetime: str | None, tz_name: str = "UTC") -> str:
    """
    Format an ISO datetime for created/updated info: "m/d/yyyy, h:mm am/pm" in the given timezone.
    Accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:MM:SS", "YYYY-MM-DDTHH:MM:SSZ", or "YYYY-MM-DDTHH:MM:SS.ffffff".
    """
    if not iso_datetime or not str(iso_datetime).strip():
        return str(iso_datetime or "")
    raw = str(iso_datetime).strip()
    try:
        tz = ZoneInfo((tz_name or "").strip() or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    if "T" in raw:
        if raw.endswith("Z"):
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(tz)
        elif "+" in raw or (len(raw) > 19 and raw[19] in "-+"):
            dt = datetime.fromisoformat(raw).astimezone(tz)
        else:
            dt = datetime.fromisoformat(raw).replace(tzinfo=tz)
    else:
        dt = date.fromisoformat(raw[:10])
        dt = datetime.combine(dt, datetime.min.time(), tzinfo=tz)
    month = dt.month
    day = dt.day
    year = dt.year
    h = dt.hour
    m = dt.minute
    am_pm = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{month}/{day}/{year}, {h12}:{m:02d} {am_pm}"
