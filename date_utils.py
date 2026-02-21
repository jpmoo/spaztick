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
    if raw == "today" or raw == "now":
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
    if raw == "today" or raw == "now":
        return today.isoformat()
    if raw == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if raw == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    if raw == "next week" or raw == "in a week":
        return (today + timedelta(days=7)).isoformat()
    # "within the next week" / "within a week"
    if raw in ("within the next week", "within a week"):
        return (today + timedelta(days=7)).isoformat()
    # "this week" = end of current week (next Sunday, or today if today is Sunday)
    if raw == "this week":
        days_until_sunday = (6 - today.weekday()) % 7  # 6 = Sunday in Python weekday()
        return (today + timedelta(days=days_until_sunday)).isoformat()
    # "in N days" / "in the next N days" / "within the next N days"
    m = re.match(r"^in\s+(\d+)\s+days?$", raw)
    if m:
        n = int(m.group(1))
        return (today + timedelta(days=n)).isoformat()
    m = re.match(r"^in\s+the\s+next\s+(\d+)\s+days?$", raw)
    if m:
        n = int(m.group(1))
        return (today + timedelta(days=n)).isoformat()
    m = re.match(r"^within\s+the\s+next\s+(\d+)\s+days?$", raw)
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
    # "next Friday" / "next monday" etc. (same as bare weekday = next occurrence)
    m = re.match(r"^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?$", raw)
    if m:
        return resolve_relative_date(m.group(1), tz_name)
    # "this Friday" = this week's occurrence (or next if already past)
    m = re.match(r"^this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?$", raw)
    if m:
        wd = m.group(1)
        target_weekday = weekdays.index(wd)
        current_weekday = today.weekday()
        days_ahead = (target_weekday - current_weekday) % 7
        if days_ahead == 0:
            days_ahead = 7
        return (today + timedelta(days=days_ahead)).isoformat()
    # "end of month" / "eom" = last day of current month
    if raw in ("end of month", "eom", "end of this month"):
        try:
            next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
            last_day = next_month - timedelta(days=1)
            return last_day.isoformat()
        except Exception:
            pass
    # "start of next month" / "next month"
    if raw in ("start of next month", "next month"):
        try:
            next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
            return next_month.isoformat()
        except Exception:
            pass
    return None


def _parse_one_date_condition(raw: str, today: date, tz_name: str) -> dict[str, Any]:
    """Parse a single when phrase (no " and "). Used by parse_date_condition."""
    out: dict[str, Any] = {}
    # Overdue
    if raw == "overdue" or re.match(r"^overdue\s*tasks?$", raw):
        out["overdue"] = True
        return out

    # "due or available X" / "available or due X" -> available_or_due_by (tasks due by X or available by X)
    m = re.match(r"^(?:due\s+or\s+available|available\s+or\s+due)\s+(.+)$", raw)
    if m:
        date_expr = m.group(1).strip()
        resolved = resolve_relative_date(date_expr, tz_name)
        if resolved:
            out["available_or_due_by"] = resolved
            return out

    # "due before X" / "due before next Friday" -> due_before (strictly before X)
    m = re.match(r"^due\s+before\s+(.+)$", raw)
    if m:
        date_expr = m.group(1).strip()
        resolved = resolve_relative_date(date_expr, tz_name)
        if resolved:
            out["due_before"] = resolved
            return out

    # "available today" / "available now" -> available_by = today, require available_date set
    if raw in ("available today", "available now"):
        out["available_by"] = today.isoformat()
        out["available_by_required"] = True
        return out

    # "available X" (tomorrow, Friday, next week, etc.)
    if raw.startswith("available "):
        date_expr = raw[9:].strip()
        date_expr = re.sub(r"^by\s+", "", date_expr)
        resolved = resolve_relative_date(date_expr, tz_name)
        if resolved:
            out["available_by"] = resolved
            out["available_by_required"] = True
            return out

    # "due on X" -> due_on; "due by X" -> due_by; "due next Tuesday" / "due Friday" -> due_on (exact date)
    if raw.startswith("due on "):
        resolved = resolve_relative_date(raw[7:].strip(), tz_name)
        if resolved:
            out["due_on"] = resolved
            return out
    if raw.startswith("due by "):
        date_expr = re.sub(r"^within\s+", "within ", raw[7:].strip())
        resolved = resolve_relative_date(date_expr, tz_name)
        if resolved:
            out["due_by"] = resolved
            return out
    if raw.startswith("due "):
        date_expr = re.sub(r"^due\s+", "", raw)
        if re.match(r"^(within\s+|in\s+the\s+next\s+\d+|in\s+\d+\s+days?)", date_expr):
            date_expr = re.sub(r"^within\s+", "within ", date_expr)
            resolved = resolve_relative_date(date_expr, tz_name)
            if resolved:
                out["due_by"] = resolved
                return out
        resolved = resolve_relative_date(date_expr, tz_name)
        if resolved:
            out["due_on"] = resolved
            return out

    # Bare date phrase -> assume due_by
    resolved = resolve_relative_date(raw, tz_name)
    if resolved:
        out["due_by"] = resolved
    return out


def parse_date_condition(phrase: str | None, tz_name: str = "UTC") -> dict[str, Any]:
    """
    Parse a natural-language date condition for task queries (task_find).
    Returns a dict with one or more of: due_on, due_by, due_before, available_by, available_by_required, available_or_due_by, overdue.

    - "due next Tuesday" / "due Friday" / "due tomorrow" -> due_on (tasks due on that exact date only)
    - "due by Friday" / "due within the next week" / "due in 5 days" -> due_by (on or before)
    - "due before next Friday" -> due_before (strictly before)
    - "available today" / "available now" / "available tomorrow" -> available_by + available_by_required True (only tasks with available_date <= date)
    - "due or available today" / "due today, available today" -> available_or_due_by (tasks due on or available by that date)
    - "overdue" -> overdue = True
    """
    out: dict[str, Any] = {}
    if not phrase or not str(phrase).strip():
        return out
    raw = str(phrase).strip().lower()
    try:
        today = _today_in_tz((tz_name or "").strip() or "UTC")
    except Exception:
        today = date.today()

    # "due X, available X" or "due X and available X" (same date) -> available_or_due_by (OR semantics)
    for sep in (" and ", ", ", ","):
        if sep in raw:
            parts = [p.strip() for p in raw.split(sep, 1)]
            if len(parts) == 2 and parts[0] and parts[1]:
                a = _parse_one_date_condition(parts[0], today, tz_name)
                b = _parse_one_date_condition(parts[1], today, tz_name)
                if a and b:
                    # Both parsed: if one is due_on/due_by and the other available_by with same date -> available_or_due_by
                    date_a = (a.get("due_on") or a.get("due_by") or a.get("available_by"))
                    date_b = (b.get("due_on") or b.get("due_by") or b.get("available_by"))
                    if date_a and date_b and date_a == date_b:
                        out["available_or_due_by"] = date_a
                        return out
                if a or b:
                    out.update(a)
                    out.update(b)
                    return out
            break
    return _parse_one_date_condition(raw, today, tz_name)


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
