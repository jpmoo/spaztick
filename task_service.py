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

from database import get_connection, get_db_path, init_database

# Valid task statuses (constrained state machine)
STATUSES = frozenset({"inbox", "active", "blocked", "done", "archived"})
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
    status: str = "inbox",
    priority: int | None = None,
    available_date: str | None = None,
    due_date: str | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
    recurrence: dict | None = None,
    recurrence_parent_id: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """Create a single task. All mutations go through Task Service. Uses ULID for id."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    if priority is not None and (priority < PRIORITY_MIN or priority > PRIORITY_MAX):
        raise ValueError(f"priority must be {PRIORITY_MIN}-{PRIORITY_MAX}")
    tid = task_id or _new_task_id()
    now = _now_iso()
    rec_json = json.dumps(recurrence) if recurrence else None
    priority_val = priority if priority is not None else 0
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO tasks (
                id, title, description, notes, status, priority,
                available_date, due_date, recurrence, recurrence_parent_id,
                created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                tid, title, description or None, notes or None, status, priority_val,
                available_date, due_date, rec_json, recurrence_parent_id,
                now, now, None,
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
        out["projects"] = [r[0] for r in conn.execute("SELECT project_id FROM task_projects WHERE task_id = ?", (task_id,))]
        out["tags"] = [r[0] for r in conn.execute("SELECT tag FROM task_tags WHERE task_id = ?", (task_id,))]
        out["depends_on"] = [r[0] for r in conn.execute("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?", (task_id,))]
        return out
    finally:
        conn.close()


def list_tasks(
    status: str | None = None,
    project_id: str | None = None,
    tag: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List tasks with optional filters. Returns minimal task dicts (no projects/tags/deps)."""
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
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        return [_task_row_to_dict(r) for r in rows]
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
            if status == "done":
                updates.append("completed_at = ?"); params.append(now)
        if priority is not None:
            updates.append("priority = ?"); params.append(priority)
        if available_date is not None:
            updates.append("available_date = ?"); params.append(available_date)
        if due_date is not None:
            updates.append("due_date = ?"); params.append(due_date)
        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
        _record_history(conn, task_id, "updated", {"updated_at": now})
        conn.commit()
        return get_task(task_id)
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
        if row["status"] == "done":
            return get_task(task_id)
        now = _now_iso()
        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
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
                    status="inbox",
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


