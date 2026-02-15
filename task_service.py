"""
Task Service layer: all database mutations go through here.
Deterministic writes only; no direct AI-driven DB writes. Used by orchestration/API.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    from ulid import ULID
    def _new_task_id() -> str:
        return str(ULID())
except ImportError:
    def _new_task_id() -> str:
        return str(uuid.uuid4())

from database import get_connection, get_db_path, has_number_column, init_database

# Valid task statuses: only two
STATUSES = frozenset({"incomplete", "complete"})
PRIORITY_MIN, PRIORITY_MAX = 0, 3


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
    """Create a single task. All mutations go through Task Service. Uses ULID for id."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    if priority is not None and (priority < PRIORITY_MIN or priority > PRIORITY_MAX):
        raise ValueError(f"priority must be {PRIORITY_MIN}-{PRIORITY_MAX}")
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
                    tid, next_num, title, description or None, notes or None, status, priority,
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
                    tid, title, description or None, notes or None, status, priority,
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


def _add_task_relations(conn: sqlite3.Connection, out: dict[str, Any]) -> None:
    tid = out["id"]
    out["projects"] = [r[0] for r in conn.execute("SELECT project_id FROM task_projects WHERE task_id = ?", (tid,))]
    out["tags"] = [r[0] for r in conn.execute("SELECT tag FROM task_tags WHERE task_id = ?", (tid,))]
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
    tag: str | None = None,
    due_by: str | None = None,
    available_by: str | None = None,
    available_or_due_by: str | None = None,
    completed_by: str | None = None,
    completed_after: str | None = None,
    title_contains: str | None = None,
    sort_by: str | None = None,
    flagged: bool | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List tasks with optional filters. Returns minimal task dicts (no projects/tags/deps).
    due_by, available_by, available_or_due_by, completed_by, completed_after are ISO date strings (YYYY-MM-DD).
    title_contains: substring match on title (case-insensitive).
    sort_by: due_date, available_date, created_at, completed_at, title (default created_at DESC).
    """
    conn = get_connection()
    try:
        sql = "SELECT * FROM tasks WHERE 1=1"
        params: list[Any] = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if project_id:
            sql += " AND id IN (SELECT task_id FROM task_projects WHERE project_id = ?)"
            params.append(project_id)
        if tag:
            sql += " AND id IN (SELECT task_id FROM task_tags WHERE tag = ?)"
            params.append(tag)
        if due_by:
            sql += " AND due_date IS NOT NULL AND date(due_date) <= date(?)"
            params.append(due_by)
        if available_by:
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
        if flagged is not None:
            sql += " AND flagged = ?"
            params.append(1 if flagged else 0)
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
                projs = conn.execute("SELECT project_id FROM task_projects WHERE task_id = ?", (tid,)).fetchall()
                t["projects"] = [p[0] for p in projs]
            else:
                t["projects"] = []
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
    priority: int | None = None,
    available_date: str | None = None,
    due_date: str | None = None,
    flagged: bool | None = None,
) -> dict[str, Any] | None:
    """Update task fields. Only provided fields are changed."""
    if status is not None and status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    if priority is not None and (priority < PRIORITY_MIN or priority > PRIORITY_MAX):
        raise ValueError(f"priority must be {PRIORITY_MIN}-{PRIORITY_MAX}")
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
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
        if priority is not None:
            updates.append("priority = ?"); params.append(priority)
        if available_date is not None:
            updates.append("available_date = ?"); params.append(available_date)
        if due_date is not None:
            updates.append("due_date = ?"); params.append(due_date)
        if flagged is not None:
            updates.append("flagged = ?"); params.append(1 if flagged else 0)
        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
        _record_history(conn, task_id, "updated", {"updated_at": now})
        conn.commit()
        return get_task(task_id)
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
        conn.execute("DELETE FROM task_tags WHERE task_id = ? AND tag = ?", (task_id, tag))
        _record_history(conn, task_id, "tag_removed", {"tag": tag})
        conn.commit()
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


def complete_recurring_task(task_id: str, advance_recurrence: bool = True) -> dict[str, Any] | None:
    """
    Mark task done and optionally create the next instance (recurrence model).
    When completed: current instance gets done + completed_at; new instance is created
    with advanced available_date/due_date and same recurrence_parent_id.
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
        next_task = None
        if advance_recurrence and recurrence:
            try:
                rec = json.loads(recurrence) if isinstance(recurrence, str) else recurrence
            except (TypeError, json.JSONDecodeError):
                rec = None
            if rec:
                # Advance dates (simplified: caller or future logic can implement rule-based advance)
                from datetime import datetime as dt
                avail = row.get("available_date")
                due = row.get("due_date")
                # Placeholder: add 1 day; real impl would use recurrence rule (daily/weekly/monthly)
                if avail:
                    try:
                        d = dt.fromisoformat(avail.replace("Z", "+00:00"))
                        # Simple +1 day for demo
                        from datetime import timedelta
                        d = d + timedelta(days=1)
                        avail = d.strftime("%Y-%m-%d")
                    except Exception:
                        pass
                if due:
                    try:
                        d = dt.fromisoformat(due.replace("Z", "+00:00"))
                        from datetime import timedelta
                        d = d + timedelta(days=1)
                        due = d.strftime("%Y-%m-%d")
                    except Exception:
                        pass
                next_task = create_task(
                    row["title"],
                    description=row.get("description"),
                    notes=row.get("notes"),
                    status="incomplete",
                    priority=row.get("priority"),
                    available_date=avail,
                    due_date=due,
                    recurrence=rec,
                    recurrence_parent_id=recurrence_parent_id,
                )
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


