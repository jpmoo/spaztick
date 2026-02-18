"""
Task Service layer: all database mutations go through here.
Deterministic writes only; no direct AI-driven DB writes. Used by orchestration/API.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:
    from ulid import ULID
    def _new_task_id() -> str:
        return str(ULID())
except ImportError:
    def _new_task_id() -> str:
        return str(uuid.uuid4())

from database import get_connection, get_db_path, has_number_column, init_database

logger = logging.getLogger("task_service")

# Valid task statuses: only two
STATUSES = frozenset({"incomplete", "complete"})
PRIORITY_MIN, PRIORITY_MAX = 0, 3

# Sentinel: pass for optional params to mean "don't change"; None means "set to null"
_UNSET = object()


def _date_only(s: str | None) -> str | None:
    """Normalize to YYYY-MM-DD for comparison, or None if empty/invalid."""
    if not s or not isinstance(s, str):
        return None
    part = s.strip()[:10]
    return part if len(part) == 10 and part[4] == "-" and part[7] == "-" else None


def _validate_available_due(available_date: str | None, due_date: str | None) -> None:
    """Raise ValueError if both dates are set and available_date is after due_date."""
    av = _date_only(available_date)
    du = _date_only(due_date)
    if av and du and av > du:
        raise ValueError("Available date cannot be after due date. Due date cannot be before available date.")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _record_history(conn: sqlite3.Connection, task_id: str, event: str, payload: Any = None) -> None:
    conn.execute(
        "INSERT INTO task_history (task_id, timestamp, event, payload) VALUES (?, ?, ?, ?)",
        (task_id, _now_iso(), event, json.dumps(payload) if payload is not None else None),
    )


def _task_row_to_dict(row: Any) -> dict[str, Any]:
    d = dict(row)
    for key in ("recurrence",):
        if d.get(key):
            try:
                d[key] = json.loads(d[key])
            except (TypeError, json.JSONDecodeError):
                pass
    # All tasks expose at least priority 0; never return null to clients
    if d.get("priority") is None:
        d["priority"] = 0
    return d


def ensure_db() -> None:
    """Bootstrap database on first run."""
    init_database()


def create_task(
    title: str,
    *,
    description: str | None = None,
    notes: str | None = None,
    status: str = "incomplete",
    priority: int | None = None,
    available_date: str | None = None,
    due_date: str | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
    recurrence: dict | None = None,
    recurrence_parent_id: str | None = None,
    task_id: str | None = None,
    flagged: bool = False,
) -> dict[str, Any]:
    """Create a single task. All mutations go through Task Service. Uses ULID for id. Priority defaults to 0."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    eff_priority = priority if priority is not None else 0
    if eff_priority < PRIORITY_MIN or eff_priority > PRIORITY_MAX:
        raise ValueError(f"priority must be {PRIORITY_MIN}-{PRIORITY_MAX}")
    _validate_available_due(available_date, due_date)
    if recurrence and not _date_only(due_date):
        raise ValueError("Recurrence requires a due date.")
    tid = task_id or _new_task_id()
    now = _now_iso()
    rec_json = json.dumps(recurrence) if recurrence else None
    conn = get_connection()
    try:
        use_number = has_number_column(conn)
        flag_val = 1 if flagged else 0
        if use_number:
            next_num = conn.execute("SELECT COALESCE(MAX(number), 0) + 1 FROM tasks").fetchone()[0]
            conn.execute(
                """INSERT INTO tasks (
                    id, number, title, description, notes, status, priority,
                    available_date, due_date, recurrence, recurrence_parent_id,
                    created_at, updated_at, completed_at, flagged
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tid, next_num, title, description or None, notes or None, status, eff_priority,
                    available_date, due_date, rec_json, recurrence_parent_id,
                    now, now, None, flag_val,
                ),
            )
        else:
            conn.execute(
                """INSERT INTO tasks (
                    id, title, description, notes, status, priority,
                    available_date, due_date, recurrence, recurrence_parent_id,
                    created_at, updated_at, completed_at, flagged
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tid, title, description or None, notes or None, status, eff_priority,
                    available_date, due_date, rec_json, recurrence_parent_id,
                    now, now, None, flag_val,
                ),
            )
        for project_id in projects or []:
            if project_id:
                conn.execute(
                    "INSERT OR IGNORE INTO task_projects (task_id, project_id) VALUES (?, ?)",
                    (tid, project_id),
                )
        for tag in tags or []:
            if tag:
                conn.execute(
                    "INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)",
                    (tid, tag),
                )
        _record_history(conn, tid, "created", {"title": title, "status": status})
        conn.commit()
        return get_task(tid)
    finally:
        conn.close()


def get_task(task_id: str) -> dict[str, Any] | None:
    """Return one task by id with projects, tags, and dependencies."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        out = _task_row_to_dict(row)
        _add_task_relations(conn, out)
        return out
    finally:
        conn.close()


def _tags_for_task(
    conn: sqlite3.Connection,
    task_id: str,
    title: str | None = None,
    description: str | None = None,
    notes: str | None = None,
) -> list[str]:
    """Return tags for a task: from task_tags plus #word in title/description/notes (skip # inside URLs). Case-insensitive dedupe."""
    from_tags = [r[0] for r in conn.execute("SELECT tag FROM task_tags WHERE task_id = ?", (task_id,))]
    seen: set[str] = set()
    out: list[str] = []
    for t in from_tags:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            out.append(k)
    for text in (title or "", description or "", notes or ""):
        if not text:
            continue
        for m in _HASHTAG_NOT_IN_URL_RE.finditer(text):
            tagname = m.group(2).lower()
            if tagname not in seen:
                seen.add(tagname)
                out.append(tagname)
    return out


def _add_task_relations(conn: sqlite3.Connection, out: dict[str, Any]) -> None:
    tid = out["id"]
    # Only include projects that are active (archived projects hidden from task listing/inspector)
    out["projects"] = [
        r[0]
        for r in conn.execute(
            """SELECT tp.project_id FROM task_projects tp
               INNER JOIN projects p ON p.id = tp.project_id AND p.status = 'active'
               WHERE tp.task_id = ?""",
            (tid,),
        )
    ]
    out["tags"] = _tags_for_task(
        conn, tid,
        out.get("title"), out.get("description"), out.get("notes"),
    )
    out["depends_on"] = [r[0] for r in conn.execute("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?", (tid,))]


def get_task_by_number(number: int) -> dict[str, Any] | None:
    """Return one task by friendly number (user-facing id)."""
    conn = get_connection()
    try:
        if not has_number_column(conn):
            return None
        row = conn.execute("SELECT * FROM tasks WHERE number = ?", (number,)).fetchone()
        if not row:
            return None
        out = _task_row_to_dict(row)
        _add_task_relations(conn, out)
        return out
    finally:
        conn.close()


def get_tasks_that_depend_on(task_id: str) -> list[dict[str, Any]]:
    """Return tasks that have this task as a dependency (subtasks). Minimal task dicts."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT t.* FROM tasks t JOIN task_dependencies d ON t.id = d.task_id WHERE d.depends_on_task_id = ? ORDER BY t.created_at",
            (task_id,),
        ).fetchall()
        return [_task_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def list_tasks(
    status: str | None = None,
    project_id: str | None = None,
    project_ids: list[str] | None = None,
    project_mode: str = "any",
    inbox: bool = False,
    tag: str | None = None,
    tags: list[str] | None = None,
    tag_mode: str = "any",
    due_by: str | None = None,
    due_before: str | None = None,
    available_by: str | None = None,
    available_by_required: bool = False,
    available_or_due_by: str | None = None,
    completed_by: str | None = None,
    completed_after: str | None = None,
    title_contains: str | None = None,
    search: str | None = None,
    q: str | None = None,
    sort_by: str | None = None,
    flagged: bool | None = None,
    priority: int | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List tasks with optional filters. Returns minimal task dicts (no projects/tags/deps).
    due_by, due_before, available_by, available_or_due_by, completed_by, completed_after are ISO date strings (YYYY-MM-DD).
    due_before: tasks with due_date strictly before this date (exclusive).
    available_by_required: if True with available_by, only tasks that have available_date set and <= date (excludes NULL; "available today" = on my plate today).
    title_contains: substring match on title (case-insensitive).
    search: substring match on title OR description (case-insensitive).
    q: match tag exactly OR title OR description OR notes (substring). Use for combined/tag search.
    sort_by: due_date, available_date, created_at, completed_at, title (default created_at DESC).
    priority: 0-3 to filter by exact priority (3 = highest).
    inbox: if True, only tasks that have no project (inbox = unassigned). Ignored if project_id/project_ids set.
    tags: list of tag names; tag_mode "any" = task has any of these (OR), "all" = task has all (AND).
    project_ids: list of project ids; project_mode "any" = task in any of these (OR), "all" = task in all (AND).
    """
    conn = get_connection()
    try:
        sql = "SELECT * FROM tasks WHERE 1=1"
        params: list[Any] = []
        use_project_list = project_ids and len(project_ids) > 0
        use_tag_list = tags and len(tags) > 0
        if status:
            sql += " AND status = ?"
            params.append(status)
        if inbox and not project_id and not use_project_list:
            sql += " AND id NOT IN (SELECT task_id FROM task_projects)"
        elif use_project_list:
            if (project_mode or "any").strip().lower() == "all":
                for pid in project_ids:
                    sql += " AND id IN (SELECT task_id FROM task_projects WHERE project_id = ?)"
                    params.append(pid)
            else:
                placeholders = ",".join("?" * len(project_ids))
                sql += f" AND id IN (SELECT task_id FROM task_projects WHERE project_id IN ({placeholders}))"
                params.extend(project_ids)
        elif project_id:
            sql += " AND id IN (SELECT task_id FROM task_projects WHERE project_id = ?)"
            params.append(project_id)
        if use_tag_list:
            tags = [((t or "").strip().lstrip("#").strip() or (t or "").strip()) for t in tags if (t or "").strip()]
            if (tag_mode or "any").strip().lower() == "all":
                # Task must have each tag (in task_tags or #tag in title/description/notes); tag match case-insensitive
                for tname in tags:
                    frag, p = _sql_hashtag_in_text_condition(tname)
                    sql += f" AND (id IN (SELECT task_id FROM task_tags WHERE LOWER(tag) = LOWER(?)) OR {frag})"
                    params.append(tname)
                    params.extend(p)
            else:
                # Task has any of the tags (in task_tags or #tag in text); tag match case-insensitive
                tag_conds = " OR ".join(["LOWER(tag) = LOWER(?)" for _ in tags])
                tag_frag = f"id IN (SELECT task_id FROM task_tags WHERE {tag_conds})"
                text_frags = []
                text_params: list[Any] = []
                for tname in tags:
                    frag, p = _sql_hashtag_in_text_condition(tname)
                    text_frags.append(frag)
                    text_params.extend(p)
                sql += " AND (" + tag_frag + " OR " + " OR ".join(text_frags) + ")"
                params.extend(tags)
                params.extend(text_params)
        elif tag:
            tag_val = (tag or "").strip().lstrip("#").strip() or (tag or "").strip()
            frag, p = _sql_hashtag_in_text_condition(tag_val)
            sql += f" AND (id IN (SELECT task_id FROM task_tags WHERE LOWER(tag) = LOWER(?)) OR {frag})"
            params.append(tag_val)
            params.extend(p)
        if due_by:
            sql += " AND due_date IS NOT NULL AND date(due_date) <= date(?)"
            params.append(due_by)
        if due_before:
            sql += " AND due_date IS NOT NULL AND date(due_date) < date(?)"
            params.append(due_before)
        if available_by:
            if available_by_required:
                sql += " AND available_date IS NOT NULL AND date(available_date) <= date(?)"
            else:
                sql += " AND (available_date IS NULL OR date(available_date) <= date(?))"
            params.append(available_by)
        if available_or_due_by:
            sql += " AND ((available_date IS NULL OR date(available_date) <= date(?)) OR (due_date IS NULL OR date(due_date) <= date(?)))"
            params.append(available_or_due_by)
            params.append(available_or_due_by)
        if completed_by:
            sql += " AND completed_at IS NOT NULL AND date(completed_at) <= date(?)"
            params.append(completed_by)
        if completed_after:
            sql += " AND completed_at IS NOT NULL AND date(completed_at) >= date(?)"
            params.append(completed_after)
        if title_contains and title_contains.strip():
            sql += " AND title LIKE ?"
            params.append(f"%{title_contains.strip()}%")
        if search and search.strip():
            s = search.strip()
            sql += " AND (title LIKE ? OR description LIKE ?)"
            params.append(f"%{s}%")
            params.append(f"%{s}%")
        if q and q.strip():
            qv = q.strip()
            sql += " AND (id IN (SELECT task_id FROM task_tags WHERE LOWER(tag) = LOWER(?)) OR title LIKE ? OR description LIKE ? OR notes LIKE ?)"
            params.append(qv)
            params.append(f"%{qv}%")
            params.append(f"%{qv}%")
            params.append(f"%{qv}%")
        if flagged is not None:
            sql += " AND flagged = ?"
            params.append(1 if flagged else 0)
        if priority is not None and PRIORITY_MIN <= priority <= PRIORITY_MAX:
            sql += " AND priority = ?"
            params.append(priority)
        order = "ORDER BY created_at DESC"
        if sort_by:
            sort_by_lower = sort_by.strip().lower()
            if sort_by_lower == "due_date":
                order = "ORDER BY due_date IS NULL, due_date ASC, created_at DESC"
            elif sort_by_lower == "available_date":
                order = "ORDER BY available_date IS NULL, available_date ASC, created_at DESC"
            elif sort_by_lower == "title":
                order = "ORDER BY title ASC, created_at DESC"
            elif sort_by_lower == "created_at":
                order = "ORDER BY created_at DESC"
            elif sort_by_lower == "completed_at":
                order = "ORDER BY completed_at IS NULL, completed_at DESC, created_at DESC"
        sql += f" {order} LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        out = [_task_row_to_dict(r) for r in rows]
        for t in out:
            tid = t.get("id")
            if tid:
                projs = conn.execute(
                    """SELECT tp.project_id FROM task_projects tp
                       INNER JOIN projects p ON p.id = tp.project_id AND p.status = 'active'
                       WHERE tp.task_id = ?""",
                    (tid,),
                ).fetchall()
                t["projects"] = [p[0] for p in projs]
                t["tags"] = _tags_for_task(
                    conn, tid,
                    t.get("title"), t.get("description"), t.get("notes"),
                )
            else:
                t["projects"] = []
                t["tags"] = []
        return out
    finally:
        conn.close()


def update_task(
    task_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    notes: str | None = None,
    status: str | None = None,
    priority: int | None = _UNSET,
    available_date: str | None = _UNSET,
    due_date: str | None = _UNSET,
    flagged: bool | None = None,
    recurrence: dict | None = _UNSET,
) -> dict[str, Any] | None:
    """Update task fields. Only provided fields are changed. Pass _UNSET to leave priority/recurrence unchanged; None is stored as 0 for priority or clears recurrence."""
    if status is not None and status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    if priority is not _UNSET and priority is not None and (priority < PRIORITY_MIN or priority > PRIORITY_MAX):
        raise ValueError(f"priority must be {PRIORITY_MIN}-{PRIORITY_MAX}")
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        # Effective dates: new value if updating, else current (None means clear)
        eff_av = available_date if available_date is not _UNSET else (row["available_date"] if row["available_date"] else None)
        eff_due = due_date if due_date is not _UNSET else (row["due_date"] if row["due_date"] else None)
        _validate_available_due(eff_av, eff_due)
        if recurrence is not _UNSET and recurrence is not None and not _date_only(eff_due):
            raise ValueError("Recurrence requires a due date.")
        now = _now_iso()
        # Always touch updated_at; set completed_at when marking complete
        updates: list[str] = ["updated_at = ?"]
        params: list[Any] = [now]
        if title is not None:
            updates.append("title = ?"); params.append(title)
        if description is not None:
            updates.append("description = ?"); params.append(description)
        if notes is not None:
            updates.append("notes = ?"); params.append(notes)
        if status is not None:
            updates.append("status = ?"); params.append(status)
            if status == "complete":
                updates.append("completed_at = ?"); params.append(now)
        if priority is not _UNSET:
            # Never write null: treat None as 0
            updates.append("priority = ?"); params.append(0 if priority is None else priority)
        if available_date is not _UNSET:
            updates.append("available_date = ?"); params.append(available_date)
        if due_date is not _UNSET:
            updates.append("due_date = ?"); params.append(due_date)
        if flagged is not None:
            updates.append("flagged = ?"); params.append(1 if flagged else 0)
        if recurrence is not _UNSET:
            updates.append("recurrence = ?")
            rec_json = json.dumps(recurrence) if recurrence else None
            params.append(rec_json)
            logger.info("[task_service] update_task %s writing recurrence: %s", task_id, (rec_json[:200] + "..." if rec_json and len(rec_json) > 200 else rec_json))
        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
        _record_history(conn, task_id, "updated", {"updated_at": now})
        conn.commit()
        return get_task(task_id)
    finally:
        conn.close()


def normalize_task_priorities() -> int:
    """Set priority to 0 for all tasks where priority IS NULL. Returns number of rows updated."""
    conn = get_connection()
    try:
        cur = conn.execute("UPDATE tasks SET priority = 0 WHERE priority IS NULL")
        n = cur.rowcount
        conn.commit()
        return n
    finally:
        conn.close()


def delete_task(task_id: str) -> bool:
    """Delete a task and its history. Returns True if deleted, False if not found."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM task_history WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM task_projects WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM task_tags WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?", (task_id, task_id))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return True
    finally:
        conn.close()


def add_task_project(task_id: str, project_id: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO task_projects (task_id, project_id) VALUES (?, ?)",
            (task_id, project_id),
        )
        _record_history(conn, task_id, "project_added", {"project_id": project_id})
        conn.commit()
    finally:
        conn.close()


def remove_task_project(task_id: str, project_id: str) -> None:
    conn = get_connection()
    try:
        conn.execute("DELETE FROM task_projects WHERE task_id = ? AND project_id = ?", (task_id, project_id))
        _record_history(conn, task_id, "project_removed", {"project_id": project_id})
        conn.commit()
    finally:
        conn.close()


def add_task_tag(task_id: str, tag: str) -> None:
    """Add a tag to a task. Stored in lowercase so #Meghan and #meghan are the same."""
    tag = (tag or "").strip().lower()
    if not tag:
        return
    conn = get_connection()
    try:
        conn.execute("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)", (task_id, tag))
        _record_history(conn, task_id, "tag_added", {"tag": tag})
        conn.commit()
    finally:
        conn.close()


def remove_task_tag(task_id: str, tag: str) -> None:
    conn = get_connection()
    try:
        conn.execute("DELETE FROM task_tags WHERE task_id = ? AND LOWER(tag) = LOWER(?)", (task_id, tag))
        _record_history(conn, task_id, "tag_removed", {"tag": tag})
        conn.commit()
    finally:
        conn.close()


def _hashtag_regex(tag: str, case_insensitive: bool = False) -> re.Pattern:
    """Match #tag as whole word (not #tagging or #tags). If case_insensitive, #Meghan matches #meghan."""
    flags = re.IGNORECASE if case_insensitive else 0
    return re.compile(r"#" + re.escape(tag) + r"(?![a-zA-Z0-9_-])", flags)


# Match #word only when not inside a URL (not after ., :, /, or alphanumeric). Used for tag extraction.
_HASHTAG_NOT_IN_URL_RE = re.compile(r"(?:^|[^.:/A-Za-z0-9-])(#([a-zA-Z0-9_-]+))")


def _hashtag_not_in_url_regex(tag: str, case_insensitive: bool = False) -> re.Pattern:
    """Match #tag as whole word only when not inside a URL. For use in sub (rename/remove)."""
    flags = re.IGNORECASE if case_insensitive else 0
    return re.compile(
        r"(?<![.:/A-Za-z0-9-])#" + re.escape(tag) + r"(?![a-zA-Z0-9_-])",
        flags,
    )


def _like_escape(tag: str) -> str:
    """Escape % and _ for use in SQLite LIKE (use ESCAPE '\\')."""
    return tag.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _sql_hashtag_in_text_condition(tag: str) -> tuple[str, list[Any]]:
    """
    Return (sql_fragment, params) for "this task has #tag in title or description or notes" (whole-word).
    Case-insensitive: #Meghan and #meghan in text both match. Uses LOWER(column) LIKE lowercase pattern.
    """
    t = (tag or "").strip()
    if not t:
        return ("0", [])
    t_lower = t.lower()
    needle = "#" + _like_escape(t_lower)
    # Whole-word #tag: at start or after space (exclude "%" + needle so we don't match #tag inside URLs like x.com#tag)
    pats = [needle, needle + " %", "% " + needle, "% " + needle + " %"]
    frags: list[str] = []
    params: list[Any] = []
    for col in ("title", "description", "notes"):
        for p in pats:
            frags.append(f"LOWER({col}) LIKE ? ESCAPE '\\'")
            params.append(p)
    return ("(" + " OR ".join(frags) + ")", params)


def tag_list() -> list[dict[str, Any]]:
    """
    Return all tags with the number of distinct tasks that have that tag.
    A task has a tag if: the tag is in task_tags, or #tag appears in title, or #tag in description/notes.
    Case-insensitive: meghan and Meghan are one tag (canonical lowercase). Each task counted once per tag.
    """
    conn = get_connection()
    try:
        tag_to_task_ids: dict[str, set[str]] = {}
        # From task_tags (key by lowercase so meghan/Meghan merge)
        for row in conn.execute("SELECT tag, task_id FROM task_tags").fetchall():
            t, tid = row[0], row[1]
            key = t.lower()
            if key not in tag_to_task_ids:
                tag_to_task_ids[key] = set()
            tag_to_task_ids[key].add(tid)
        # From title, description, notes: extract #word (skip when inside a URL)
        for row in conn.execute("SELECT id, title, description, notes FROM tasks").fetchall():
            tid, title, desc, notes = row[0], row[1] or "", row[2] or "", row[3] or ""
            for text in (title, desc, notes):
                for m in _HASHTAG_NOT_IN_URL_RE.finditer(text):
                    tagname = m.group(2).lower()
                    if tagname not in tag_to_task_ids:
                        tag_to_task_ids[tagname] = set()
                    tag_to_task_ids[tagname].add(tid)
        return [{"tag": tag, "count": len(ids)} for tag, ids in sorted(tag_to_task_ids.items())]
    finally:
        conn.close()


def tag_rename(old_tag: str, new_tag: str) -> int:
    """
    Rename a tag everywhere: in task_tags and in any task title/description/notes (#old_tag -> #new_tag).
    new_tag must be non-empty. Returns number of tasks whose title/description/notes were updated.
    """
    old_tag = (old_tag or "").strip()
    new_tag = (new_tag or "").strip().lower()
    if not old_tag:
        raise ValueError("old_tag is required")
    if not new_tag:
        raise ValueError("new_tag is required")
    if old_tag.lower() == new_tag:
        return 0
    conn = get_connection()
    try:
        # task_tags: for each task that had old_tag (case-insensitive), remove old and add new (avoid duplicate)
        task_ids_with_old = [r[0] for r in conn.execute("SELECT task_id FROM task_tags WHERE LOWER(tag) = LOWER(?)", (old_tag,)).fetchall()]
        conn.execute("DELETE FROM task_tags WHERE LOWER(tag) = LOWER(?)", (old_tag,))
        for tid in task_ids_with_old:
            conn.execute("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)", (tid, new_tag))
        # Replace #old_tag with #new_tag in title, description, notes (skip when inside URL)
        pat = _hashtag_not_in_url_regex(old_tag, case_insensitive=True)
        repl = "#" + new_tag
        updated = 0
        now = _now_iso()
        for row in conn.execute("SELECT id, title, description, notes FROM tasks").fetchall():
            tid, title, desc, notes = row[0], row[1] or "", row[2] or "", row[3] or ""
            new_title = pat.sub(repl, title) if title else title
            new_desc = pat.sub(repl, desc) if desc else desc
            new_notes = pat.sub(repl, notes) if notes else notes
            if new_title != title or new_desc != desc or new_notes != notes:
                conn.execute(
                    "UPDATE tasks SET title = ?, description = ?, notes = ?, updated_at = ? WHERE id = ?",
                    (new_title, new_desc, new_notes, now, tid),
                )
                _record_history(conn, tid, "tag_renamed_in_text", {"old_tag": old_tag, "new_tag": new_tag})
                updated += 1
        conn.commit()
        return updated
    finally:
        conn.close()


def tag_delete(tag: str) -> int:
    """
    Remove a tag from all tasks: delete from task_tags and strip the # from #tag in title/description/notes
    (so "#meghan" becomes "meghan"; the word is left in place).
    Returns number of tasks whose title/description/notes were updated (excluding tag-table-only removals).
    """
    tag = (tag or "").strip()
    if not tag:
        raise ValueError("tag is required")
    conn = get_connection()
    try:
        conn.execute("DELETE FROM task_tags WHERE LOWER(tag) = LOWER(?)", (tag,))
        pat = _hashtag_not_in_url_regex(tag, case_insensitive=True)
        updated = 0
        now = _now_iso()
        for row in conn.execute("SELECT id, title, description, notes FROM tasks").fetchall():
            tid, title, desc, notes = row[0], row[1] or "", row[2] or "", row[3] or ""
            # Replace #tag with tag (remove only the #) when not inside URL; collapse adjacent spaces
            def strip_tag_marker(text: str) -> str:
                if not text:
                    return text
                return re.sub(r"\s+", " ", pat.sub(lambda m: m.group(0)[1:], text)).strip()
            new_title = strip_tag_marker(title)
            new_desc = strip_tag_marker(desc)
            new_notes = strip_tag_marker(notes)
            if new_title != title or new_desc != desc or new_notes != notes:
                conn.execute(
                    "UPDATE tasks SET title = ?, description = ?, notes = ?, updated_at = ? WHERE id = ?",
                    (new_title, new_desc, new_notes, now, tid),
                )
                _record_history(conn, tid, "tag_removed_from_text", {"tag": tag})
                updated += 1
        conn.commit()
        return updated
    finally:
        conn.close()


def add_task_dependency(task_id: str, depends_on_task_id: str) -> None:
    if task_id == depends_on_task_id:
        raise ValueError("task cannot depend on itself")
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
            (task_id, depends_on_task_id),
        )
        _record_history(conn, task_id, "dependency_added", {"depends_on_task_id": depends_on_task_id})
        conn.commit()
    finally:
        conn.close()


def remove_task_dependency(task_id: str, depends_on_task_id: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?",
            (task_id, depends_on_task_id),
        )
        _record_history(conn, task_id, "dependency_removed", {"depends_on_task_id": depends_on_task_id})
        conn.commit()
    finally:
        conn.close()


def _recurrence_weekday_to_python(day: int | str) -> int:
    """Spec: 0=Sun..6=Sat. Python: Mon=0, Tue=1, ..., Sun=6. Returns Python weekday."""
    if isinstance(day, str):
        codes = {"su": 6, "mo": 0, "tu": 1, "we": 2, "th": 3, "fr": 4, "sa": 5}
        return codes.get(day.lower()[:2], 0)
    return (day - 1) % 7 if 0 <= day <= 6 else 0


def _recurrence_next_occurrence(rec: dict[str, Any], reference: date) -> date | None:
    """
    Compute the next occurrence date strictly after the reference date per recurrence rule.
    Returns None if no next occurrence can be determined (invalid rule or unsupported).
    """
    freq = (rec.get("freq") or "daily").lower()
    interval = max(1, int(rec.get("interval") or 1))

    if freq == "daily":
        return reference + timedelta(days=interval)

    if freq == "weekly":
        by_weekday = rec.get("by_weekday")
        if not by_weekday or not isinstance(by_weekday, list):
            return reference + timedelta(days=7 * interval)
        weekdays_py = [_recurrence_weekday_to_python(d) for d in by_weekday]
        # Epoch: Monday of reference week (Python Monday=0)
        epoch = reference - timedelta(days=reference.weekday())
        # Next occurrence: smallest d > reference with d.weekday() in weekdays_py and (d - epoch).days // 7 % interval == 0
        for k in range(1, 7 * interval + 8):
            d = reference + timedelta(days=k)
            if d.weekday() not in weekdays_py:
                continue
            if ((d - epoch).days // 7) % interval == 0:
                return d
        return reference + timedelta(days=7 * interval)

    if freq == "monthly":
        rule = rec.get("monthly_rule")
        if rule == "day_of_month":
            day_num = rec.get("monthly_day")
            if day_num is None or not 1 <= day_num <= 31:
                return reference + timedelta(days=28)
            # Next month(s) until we get a valid day on or after reference
            y, m = reference.year, reference.month
            for _ in range(0, 25):
                try:
                    cand = date(y, m, min(day_num, _month_max_day(y, m)))
                except ValueError:
                    cand = date(y, m, _month_max_day(y, m))
                if cand > reference:
                    return cand
                m += 1
                if m > 12:
                    m = 1
                    y += 1
            return None
        if rule == "weekday_of_month":
            week_ord = rec.get("monthly_week")
            wday_spec = rec.get("monthly_weekday")
            if week_ord is None or wday_spec is None:
                return reference + timedelta(days=28)
            wday_py = _recurrence_weekday_to_python(wday_spec)
            y, m = reference.year, reference.month
            for _ in range(0, 25):
                cand = _nth_weekday_in_month(y, m, week_ord, wday_py)
                if cand and cand > reference:
                    return cand
                m += 1
                if m > 12:
                    m = 1
                    y += 1
            return None
        return reference + timedelta(days=28)

    if freq == "yearly":
        ym = rec.get("yearly_month")
        yd = rec.get("yearly_day")
        if ym is None or not 1 <= ym <= 12:
            return reference + timedelta(days=365)
        if yd is None or not 1 <= yd <= 31:
            yd = 1
        y = reference.year
        for _ in range(0, 5):
            try:
                cand = date(y, ym, min(yd, _month_max_day(y, ym)))
            except ValueError:
                cand = date(y, ym, _month_max_day(y, ym))
            if cand > reference:
                return cand
            y += interval
        return None

    return reference + timedelta(days=interval)


def _month_max_day(year: int, month: int) -> int:
    if month in (4, 6, 9, 11):
        return 30
    if month == 2:
        return 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28
    return 31


def _nth_weekday_in_month(year: int, month: int, n: int, weekday_py: int) -> date | None:
    """n: 1=First, 2=Second, 3=Third, 4=Fourth, 5=Last. weekday_py: Python Mon=0..Sun=6."""
    try:
        first = date(year, month, 1)
    except ValueError:
        return None
    # weekday of 1st
    shift = (weekday_py - first.weekday()) % 7
    if shift:
        first_occ = first + timedelta(days=shift)
    else:
        first_occ = first
    if n == 5:
        # Last: last occurrence of this weekday in the month
        last_day = date(year, month, _month_max_day(year, month))
        back = (last_day.weekday() - weekday_py) % 7
        return last_day - timedelta(days=back)
    # 1..4: first_occ + (n-1)*7
    if 1 <= n <= 4:
        cand = first_occ + timedelta(days=(n - 1) * 7)
        if cand.month == month:
            return cand
    return None


def complete_recurring_task(task_id: str, advance_recurrence: bool = True) -> dict[str, Any] | None:
    """
    Mark task done and optionally create the next instance (recurrence model).
    When completed: current instance gets done + completed_at; new instance is created
    with advanced available_date/due_date and same recurrence_parent_id, per RECURRENCE_SPEC.
    """
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        row = dict(row)
        if row["status"] == "complete":
            return get_task(task_id)
        now = _now_iso()
        conn.execute(
            "UPDATE tasks SET status = 'complete', completed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, task_id),
        )
        _record_history(conn, task_id, "completed", {"completed_at": now})
        recurrence = row.get("recurrence")
        recurrence_parent_id = row.get("recurrence_parent_id") or task_id
        if advance_recurrence and recurrence:
            try:
                rec = json.loads(recurrence) if isinstance(recurrence, str) else recurrence
            except (TypeError, json.JSONDecodeError):
                rec = None
            if rec:
                anchor = (rec.get("anchor") or "scheduled").lower()
                ref_str = None
                if anchor == "completed":
                    ref_str = _date_only(now) or now[:10]
                else:
                    ref_str = _date_only(row.get("due_date") or "") or _date_only(row.get("available_date") or "")
                if ref_str:
                    try:
                        ref_date = date.fromisoformat(ref_str)
                    except ValueError:
                        ref_date = date.today()
                    # End condition: after_count — count existing instances in chain (including this one)
                    end_condition = rec.get("end_condition") or "never"
                    skip_from_count = False
                    if end_condition == "after_count":
                        count = conn.execute(
                            "SELECT COUNT(*) FROM tasks WHERE recurrence_parent_id = ?",
                            (recurrence_parent_id,),
                        ).fetchone()[0]
                        if count >= int(rec.get("end_after_count") or 0):
                            skip_from_count = True
                    next_due_date = _recurrence_next_occurrence(rec, ref_date) if not skip_from_count else None
                    if next_due_date and end_condition == "end_date":
                        end_d = _date_only(rec.get("end_date") or "")
                        if end_d and next_due_date.isoformat() > end_d:
                            next_due_date = None
                    if next_due_date:
                        prev_due_str = _date_only(row.get("due_date") or "")
                        prev_avail_str = _date_only(row.get("available_date") or "")
                        next_due_str = next_due_date.isoformat()
                        delta_days = 0
                        if prev_due_str:
                            try:
                                prev_due = date.fromisoformat(prev_due_str)
                                delta_days = (next_due_date - prev_due).days
                            except ValueError:
                                pass
                        if prev_avail_str and delta_days != 0:
                            try:
                                prev_avail = date.fromisoformat(prev_avail_str)
                                new_avail = prev_avail + timedelta(days=delta_days)
                                next_avail_str = new_avail.isoformat()
                            except ValueError:
                                next_avail_str = next_due_str
                        else:
                            next_avail_str = next_due_str if prev_avail_str else None
                        copy_project_ids = [
                            str(r[0]).strip()
                            for r in conn.execute(
                                "SELECT project_id FROM task_projects WHERE task_id = ?",
                                (task_id,),
                            ).fetchall()
                            if r[0]
                        ]
                        copy_tags = [
                            str(r[0]).strip()
                            for r in conn.execute(
                                "SELECT tag FROM task_tags WHERE task_id = ?",
                                (task_id,),
                            ).fetchall()
                            if r[0]
                        ]
                        copy_flagged = bool(row.get("flagged"))
                        # Recurrence copy: same projects, tags, priority, description, notes, flagged;
                        # only dates are advanced. Commit before create_task() to avoid DB lock.
                        conn.commit()
                        create_task(
                            row["title"],
                            description=row.get("description"),
                            notes=row.get("notes"),
                            status="incomplete",
                            priority=row["priority"] if row.get("priority") is not None else 0,
                            available_date=next_avail_str,
                            due_date=next_due_str,
                            recurrence=rec,
                            recurrence_parent_id=recurrence_parent_id,
                            projects=copy_project_ids if copy_project_ids else None,
                            tags=copy_tags if copy_tags else None,
                            flagged=copy_flagged,
                        )
                    # else: no next (past end_date or count exhausted); only mark complete
        conn.commit()
        return get_task(task_id)
    finally:
        conn.close()


def get_task_history(task_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """Return history events for a task (audit/analytics)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, task_id, timestamp, event, payload FROM task_history WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            if d.get("payload"):
                try:
                    d["payload"] = json.loads(d["payload"])
                except (TypeError, json.JSONDecodeError):
                    pass
            out.append(d)
        return out
    finally:
        conn.close()


