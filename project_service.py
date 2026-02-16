"""
Project service: CRUD for projects. short_id is a unique 1–4 alphanumeric user-facing id.
"""
from __future__ import annotations

import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    from ulid import ULID
    def _new_id() -> str:
        return str(ULID())
except ImportError:
    def _new_id() -> str:
        return str(uuid.uuid4())

from database import get_connection, init_database

PROJECT_STATUSES = frozenset({"active", "archived"})
SHORT_ID_MAX_LEN = 4


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _alphanumeric(s: str) -> str:
    """Lowercase alphanumeric only."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _default_short_id_candidate(name: str) -> str:
    """First 4 alphanumeric chars of name (or fewer if name is short)."""
    base = _alphanumeric(name)
    return base[:SHORT_ID_MAX_LEN] if base else "p"


def _find_available_short_id(conn: sqlite3.Connection, name: str) -> str:
    """
    Default: first 4 alphanumeric of name. If taken, first 3 + 'a', 'b', ... 'z'.
    short_id is unique and up to 4 chars.
    """
    candidate = _default_short_id_candidate(name)
    if not candidate:
        candidate = "p"
    row = conn.execute("SELECT 1 FROM projects WHERE short_id = ?", (candidate,)).fetchone()
    if not row:
        return candidate[:SHORT_ID_MAX_LEN]

    base = _alphanumeric(name)[:3]
    if not base:
        base = "p"
    for c in "abcdefghijklmnopqrstuvwxyz":
        short = (base + c)[:SHORT_ID_MAX_LEN]
        row = conn.execute("SELECT 1 FROM projects WHERE short_id = ?", (short,)).fetchone()
        if not row:
            return short
    for c1 in "abcdefghijklmnopqrstuvwxyz":
        for c2 in "abcdefghijklmnopqrstuvwxyz":
            short = (base[:2] + c1 + c2)[:SHORT_ID_MAX_LEN]
            row = conn.execute("SELECT 1 FROM projects WHERE short_id = ?", (short,)).fetchone()
            if not row:
                return short
    raise ValueError("Could not generate unique short_id")


def create_project(
    name: str,
    *,
    description: str | None = None,
    status: str = "active",
    project_id: str | None = None,
) -> dict[str, Any]:
    """Create a project. short_id is generated from name (unique, up to 4 alphanumeric)."""
    if status not in PROJECT_STATUSES:
        raise ValueError(f"status must be one of {sorted(PROJECT_STATUSES)}")
    pid = project_id or _new_id()
    now = _now_iso()
    conn = get_connection()
    try:
        short_id = _find_available_short_id(conn, name)
        conn.execute(
            """INSERT INTO projects (id, short_id, name, description, created_at, updated_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (pid, short_id, name.strip(), description.strip() if description else None, now, now, status),
        )
        conn.commit()
        return get_project(pid)
    finally:
        conn.close()


def list_projects(status: str | None = None) -> list[dict[str, Any]]:
    """List projects, optionally filtered by status (active | archived)."""
    conn = get_connection()
    try:
        sql = "SELECT id, short_id, name, description, created_at, updated_at, status FROM projects WHERE 1=1"
        params: list[Any] = []
        if status:
            if status not in PROJECT_STATUSES:
                raise ValueError(f"status must be one of {sorted(PROJECT_STATUSES)}")
            sql += " AND status = ?"
            params.append(status)
        if status == "archived":
            sql += " ORDER BY updated_at DESC"
        else:
            sql += " ORDER BY name"
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_project(project_id: str) -> dict[str, Any] | None:
    """Get project by id."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, short_id, name, description, created_at, updated_at, status FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_project_by_short_id(short_id: str) -> dict[str, Any] | None:
    """Get project by user-friendly short_id."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, short_id, name, description, created_at, updated_at, status FROM projects WHERE short_id = ?",
            (short_id.strip().lower(),),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _incomplete_tasks_with_no_other_active_project(conn: sqlite3.Connection, project_id: str) -> list[str]:
    """Return task ids that are incomplete, in this project, and have no other active project (would be project-less if we archive)."""
    rows = conn.execute(
        """SELECT t.id FROM tasks t
           INNER JOIN task_projects tp ON tp.task_id = t.id AND tp.project_id = ?
           WHERE t.status = 'incomplete'
           AND (
             SELECT COUNT(*) FROM task_projects tp2
             INNER JOIN projects p ON p.id = tp2.project_id AND p.status = 'active'
             WHERE tp2.task_id = t.id
           ) = 1""",
        (project_id,),
    ).fetchall()
    return [r[0] for r in rows]


def update_project(
    project_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    status: str | None = None,
) -> dict[str, Any] | None:
    """Update project. Returns updated project or None if not found. Raises ValueError if archiving would leave incomplete tasks with no project."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return None
        if status == "archived":
            blocked = _incomplete_tasks_with_no_other_active_project(conn, project_id)
            if blocked:
                n = len(blocked)
                raise ValueError(
                    f"Cannot archive: this project has {n} incomplete task(s) that are not in any other project. "
                    "Move them to another project or complete them first."
                )
        now = _now_iso()
        updates: list[str] = ["updated_at = ?"]
        params: list[Any] = [now]
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if description is not None:
            updates.append("description = ?")
            params.append(description.strip() if description else None)
        if status is not None:
            if status not in PROJECT_STATUSES:
                raise ValueError(f"status must be one of {sorted(PROJECT_STATUSES)}")
            updates.append("status = ?")
            params.append(status)
        params.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return get_project(project_id)
    finally:
        conn.close()


def delete_project(project_id: str) -> bool:
    """Delete project and its task associations. Returns True if deleted."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM task_projects WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return True
    finally:
        conn.close()
