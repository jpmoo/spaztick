"""
Saved lists service: CRUD for saved_lists and execution of list queries.
Query definitions are stored as JSON AST; compiled to parameterized SQL at runtime.
Uses same short_id algorithm as projects (1–4 alphanumeric, unique per list).
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from database import get_connection
from date_utils import resolve_date_expression

SHORT_ID_MAX_LEN = 4


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _list_row_to_dict(row: Any) -> dict[str, Any]:
    d = dict(row)
    for key in ("query_definition", "sort_definition"):
        if d.get(key):
            try:
                d[key] = json.loads(d[key])
            except (TypeError, json.JSONDecodeError):
                pass
    return d


def _alphanumeric(s: str) -> str:
    """Lowercase alphanumeric only."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _default_short_id_candidate(name: str) -> str:
    """First 4 alphanumeric chars of name (or fewer if name is short)."""
    base = _alphanumeric(name)
    return base[:SHORT_ID_MAX_LEN] if base else "l"


def _find_available_short_id(conn: sqlite3.Connection, name: str) -> str:
    """
    Default: first 4 alphanumeric of name. If taken, first 3 + 'a'..'z', then 2+2 letters.
    short_id is unique among saved_lists and up to 4 chars.
    """
    candidate = _default_short_id_candidate(name)
    if not candidate:
        candidate = "l"
    row = conn.execute("SELECT 1 FROM saved_lists WHERE short_id = ?", (candidate,)).fetchone()
    if not row:
        return candidate[:SHORT_ID_MAX_LEN]
    base = _alphanumeric(name)[:3]
    if not base:
        base = "l"
    for c in "abcdefghijklmnopqrstuvwxyz":
        short = (base + c)[:SHORT_ID_MAX_LEN]
        row = conn.execute("SELECT 1 FROM saved_lists WHERE short_id = ?", (short,)).fetchone()
        if not row:
            return short
    for c1 in "abcdefghijklmnopqrstuvwxyz":
        for c2 in "abcdefghijklmnopqrstuvwxyz":
            short = (base[:2] + c1 + c2)[:SHORT_ID_MAX_LEN]
            row = conn.execute("SELECT 1 FROM saved_lists WHERE short_id = ?", (short,)).fetchone()
            if not row:
                return short
    raise ValueError("Could not generate unique short_id for list")


def _ensure_list_short_ids(conn: sqlite3.Connection) -> None:
    """Backfill short_id for any saved_lists row where short_id IS NULL."""
    rows = conn.execute("SELECT id, name FROM saved_lists WHERE short_id IS NULL").fetchall()
    for (lid, name) in rows:
        short_id = _find_available_short_id(conn, name or "list")
        conn.execute("UPDATE saved_lists SET short_id = ? WHERE id = ?", (short_id, lid))
    if rows:
        conn.commit()
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_lists_short_id ON saved_lists(short_id)")
    except sqlite3.OperationalError:
        pass


def create_list(
    name: str,
    *,
    description: str | None = None,
    query_definition: dict | str | None = None,
    sort_definition: dict | str | None = None,
    list_id: str | None = None,
) -> dict[str, Any]:
    """Create a saved list. query_definition is required (JSON AST or dict)."""
    if not name or not str(name).strip():
        raise ValueError("name is required")
    qd = query_definition
    if qd is None:
        raise ValueError("query_definition is required")
    if isinstance(qd, dict):
        qd = json.dumps(qd)
    if not isinstance(qd, str) or not qd.strip():
        raise ValueError("query_definition must be non-empty JSON")
    sd = sort_definition
    if sd is not None:
        if isinstance(sd, dict):
            sd = json.dumps(sd)
        sd = sd.strip() or None
    lid = list_id or str(uuid.uuid4())
    now = _now_iso()
    conn = get_connection()
    try:
        _ensure_list_short_ids(conn)
        short_id = _find_available_short_id(conn, name.strip())
        conn.execute(
            """INSERT INTO saved_lists (id, short_id, name, description, query_definition, sort_definition, created_at, updated_at, telegram_send_cron)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (lid, short_id, name.strip(), (description or "").strip() or None, qd, sd, now, now, None),
        )
        conn.commit()
        return get_list(lid) or {}
    finally:
        conn.close()


def get_list(list_id: str) -> dict[str, Any] | None:
    """Get a saved list by id or short_id."""
    conn = get_connection()
    try:
        _ensure_list_short_ids(conn)
        row = conn.execute("SELECT * FROM saved_lists WHERE id = ?", (list_id,)).fetchone()
        if not row:
            row = conn.execute("SELECT * FROM saved_lists WHERE short_id = ?", (list_id,)).fetchone()
        return _list_row_to_dict(row) if row else None
    finally:
        conn.close()


def get_list_by_short_id(short_id: str) -> dict[str, Any] | None:
    """Get a saved list by short_id."""
    return get_list(short_id.strip())


def _resolve_list_id(conn: sqlite3.Connection, list_id: str) -> str | None:
    """Return internal id for list_id (uuid or short_id)."""
    row = conn.execute("SELECT id FROM saved_lists WHERE id = ? OR short_id = ?", (list_id, list_id.strip())).fetchone()
    return row[0] if row else None


def list_lists() -> list[dict[str, Any]]:
    """List all saved lists (id, short_id, name, description, created_at, updated_at; no full query/sort JSON in list)."""
    conn = get_connection()
    try:
        _ensure_list_short_ids(conn)
        rows = conn.execute(
            "SELECT id, short_id, name, description, query_definition, sort_definition, created_at, updated_at, telegram_send_cron FROM saved_lists ORDER BY name"
        ).fetchall()
        return [_list_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def update_list(
    list_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    query_definition: dict | str | None = None,
    sort_definition: dict | str | None = None,
    telegram_send_cron: str | None = None,
) -> dict[str, Any] | None:
    """Update a saved list. list_id may be id or short_id. Only provided fields are changed."""
    conn = get_connection()
    try:
        _ensure_list_short_ids(conn)
        resolved = _resolve_list_id(conn, list_id)
        if not resolved:
            return None
        row = conn.execute("SELECT * FROM saved_lists WHERE id = ?", (resolved,)).fetchone()
        if not row:
            return None
        updates = ["updated_at = ?"]
        params: list[Any] = [_now_iso()]
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip() if name else "")
        if description is not None:
            updates.append("description = ?")
            params.append((description or "").strip() or None)
        if query_definition is not None:
            qd = query_definition
            if isinstance(qd, dict):
                qd = json.dumps(qd)
            updates.append("query_definition = ?")
            params.append(qd.strip() if qd else "{}")
        if sort_definition is not None:
            sd = sort_definition
            if isinstance(sd, dict):
                sd = json.dumps(sd)
            updates.append("sort_definition = ?")
            params.append((sd or "").strip() or None)
        if telegram_send_cron is not None:
            raw = (telegram_send_cron or "").strip() or None
            updates.append("telegram_send_cron = ?")
            params.append(raw)
        params.append(resolved)
        conn.execute(f"UPDATE saved_lists SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return get_list(resolved)
    finally:
        conn.close()


def delete_list(list_id: str) -> bool:
    """Delete a saved list. list_id may be id or short_id. Returns True if deleted."""
    conn = get_connection()
    try:
        _ensure_list_short_ids(conn)
        resolved = _resolve_list_id(conn, list_id)
        if not resolved:
            return False
        cur = conn.execute("DELETE FROM saved_lists WHERE id = ?", (resolved,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_lists_with_telegram_cron() -> list[dict[str, Any]]:
    """Return lists that have telegram_send_cron set (id, short_id, name, telegram_send_cron). For scheduler."""
    conn = get_connection()
    try:
        try:
            rows = conn.execute(
                "SELECT id, short_id, name, telegram_send_cron FROM saved_lists WHERE telegram_send_cron IS NOT NULL AND trim(telegram_send_cron) != ''"
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [dict(zip(("id", "short_id", "name", "telegram_send_cron"), r)) for r in rows]
    finally:
        conn.close()


# --- AST to SQL compilation (parameterized only) ---

def _resolve_date_value(value: Any, tz_name: str) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return resolve_date_expression(s, tz_name)


def _compile_condition(cond: dict[str, Any], params: list[Any], tz_name: str, conn: sqlite3.Connection) -> str:
    """Return a single condition SQL fragment (no leading AND). Uses table alias 't' for tasks."""
    ctype = cond.get("type")
    if ctype != "condition":
        return "1=0"
    field = (cond.get("field") or "").strip().lower()
    op = (cond.get("operator") or "").strip().lower()
    value = cond.get("value")

    if field == "title":
        if op == "contains":
            params.append(f"%{value}%" if value is not None else "%%")
            return "t.title LIKE ?"
        if op == "equals":
            params.append(value if value is not None else "")
            return "t.title = ?"
        if op == "starts_with":
            params.append(f"{value}%" if value is not None else "%")
            return "t.title LIKE ?"
        if op == "ends_with":
            params.append(f"%{value}" if value is not None else "%")
            return "t.title LIKE ?"
        if op == "not_contains":
            params.append(f"%{value}%" if value is not None else "%%")
            return "t.title NOT LIKE ?"
        return "1=0"

    if field in ("available_date", "due_date", "completed_at"):
        col = "t.available_date" if field == "available_date" else ("t.due_date" if field == "due_date" else "t.completed_at")
        resolved = _resolve_date_value(value, tz_name) if op != "is_empty" else None
        if op == "is_empty":
            return f"({col} IS NULL OR {col} = '')"
        if op == "is_on" and resolved:
            params.append(resolved)
            return f"date({col}) = date(?)"
        if op == "is_before" and resolved:
            params.append(resolved)
            return f"date({col}) < date(?)"
        if op == "is_after" and resolved:
            params.append(resolved)
            return f"date({col}) > date(?)"
        if op == "is_on_or_before" and resolved:
            params.append(resolved)
            return f"date({col}) <= date(?)"
        if op == "is_on_or_after" and resolved:
            params.append(resolved)
            return f"date({col}) >= date(?)"
        return "1=0"

    if field == "status":
        if op == "equals":
            v = (value or "").strip().lower()
            if v in ("incomplete", "complete"):
                params.append(v)
                return "t.status = ?"
        return "1=0"

    if field == "flagged":
        if op == "equals":
            flag = 1 if value in (True, 1, "true", "yes", "1") else 0
            params.append(flag)
            return "t.flagged = ?"
        return "1=0"

    if field == "priority":
        try:
            pval = int(value) if value is not None else 0
        except (TypeError, ValueError):
            return "1=0"
        if op == "equals":
            params.append(pval)
            return "t.priority = ?"
        if op == "greater_than":
            params.append(pval)
            return "t.priority > ?"
        if op == "less_than":
            params.append(pval)
            return "t.priority < ?"
        if op == "greater_or_equal":
            params.append(pval)
            return "t.priority >= ?"
        if op == "less_or_equal":
            params.append(pval)
            return "t.priority <= ?"
        return "1=0"

    if field == "tags":
        if op == "is_empty":
            return "NOT EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id)"
        if op in ("includes", "excludes", "is", "is_not") and isinstance(value, list) and value:
            tags = [str(v).strip() for v in value if str(v).strip()]
            if not tags:
                return "1=1" if op in ("excludes", "is_not") else "1=0"
            or_parts = " OR ".join(["LOWER(tt.tag) = LOWER(?)" for _ in tags])
            params.extend(tags)
            if op in ("includes", "is"):
                return f"EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND ({or_parts}))"
            return f"NOT EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND ({or_parts}))"
        return "1=0"

    if field == "project":
        if op == "is_empty":
            return "NOT EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id)"
        if op in ("includes", "excludes", "is", "is_not") and value is not None:
            ids_or_short_ids = value if isinstance(value, list) else [value]
            project_ids: list[str] = []
            for x in ids_or_short_ids:
                x = str(x).strip()
                if not x:
                    continue
                row = conn.execute("SELECT id FROM projects WHERE id = ? OR short_id = ?", (x, x)).fetchone()
                if row:
                    project_ids.append(row[0])
            if not project_ids:
                return "1=1" if op in ("excludes", "is_not") else "1=0"
            placeholders = ",".join("?" * len(project_ids))
            params.extend(project_ids)
            if op in ("includes", "is"):
                return f"EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id AND tp.project_id IN ({placeholders}))"
            return f"NOT EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id AND tp.project_id IN ({placeholders}))"
        return "1=0"

    if field == "blocked":
        if op == "equals":
            is_blocked = value in (True, 1, "true", "yes", "1")
            sub = "EXISTS (SELECT 1 FROM task_dependencies d INNER JOIN tasks dep ON dep.id = d.depends_on_task_id WHERE d.task_id = t.id AND (dep.status IS NULL OR dep.status != 'complete'))"
            return sub if is_blocked else f"NOT ({sub})"
        return "1=0"

    return "1=0"


def _compile_ast(node: dict[str, Any], params: list[Any], tz_name: str, conn: sqlite3.Connection) -> str:
    """Recursively compile AST to WHERE fragment. Returns fragment only (no WHERE keyword)."""
    if not isinstance(node, dict):
        return "1=0"
    ntype = node.get("type")
    if ntype == "condition":
        return _compile_condition(node, params, tz_name, conn)
    if ntype == "group":
        children = node.get("children") or []
        if not children:
            return "1=1"
        op = (node.get("operator") or "AND").strip().upper()
        if op not in ("AND", "OR"):
            op = "AND"
        parts = []
        for c in children:
            part = _compile_ast(c, params, tz_name, conn)
            parts.append(f"({part})")
        return f" {op} ".join(parts)
    return "1=0"


def _task_row_to_dict(row: Any) -> dict[str, Any]:
    d = dict(row)
    for key in ("recurrence",):
        if d.get(key):
            try:
                d[key] = json.loads(d[key])
            except (TypeError, json.JSONDecodeError):
                pass
    if d.get("priority") is None:
        d["priority"] = 0
    return d


def _apply_sort(tasks: list[dict[str, Any]], sort_def: dict | None) -> list[dict[str, Any]]:
    """Apply sort_definition: group_by and sort_within_group. Returns new list."""
    if not sort_def or not tasks:
        return list(tasks)
    group_by = sort_def.get("group_by") or []
    sort_within = sort_def.get("sort_within_group") or []
    if not group_by and not sort_within:
        return list(tasks)

    def sort_key(task: dict[str, Any]) -> tuple:
        keys = []
        for field in group_by:
            f = str(field).strip().lower()
            if f == "project":
                projs = task.get("projects") or []
                keys.append(tuple(sorted(projs)) if projs else ())
            elif f in task:
                v = task.get(f)
                keys.append((v is None, str(v) if v is not None else ""))
            else:
                keys.append(())
        for s in sort_within:
            f = (s.get("field") or "").strip().lower()
            direction = (s.get("direction") or "asc").strip().lower()
            v = task.get(f)
            if f == "priority":
                p = 0 if v is None else (int(v) if isinstance(v, (int, float)) else 0)
                keys.append((-p if direction == "desc" else p,))
            elif f in ("due_date", "available_date", "created_at", "completed_at"):
                raw = (v or "9999-99-99")[:10] if v else "9999-99-99"
                parts = raw.split("-") if isinstance(raw, str) and len(raw) >= 10 else ["9999", "99", "99"]
                y = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 9999
                m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 99
                d = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 99
                if direction == "desc":
                    keys.append((-y, -m, -d))
                else:
                    keys.append((y, m, d))
            else:
                sval = "" if v is None else str(v)
                keys.append((sval if direction == "asc" else (1, sval),))
        return tuple(keys)

    return sorted(tasks, key=sort_key)


def run_list(
    list_id: str,
    *,
    limit: int = 500,
    tz_name: str = "UTC",
) -> list[dict[str, Any]]:
    """
    Load a saved list, compile its query_definition to SQL, run the query,
    apply sort_definition, and return tasks (with projects populated).
    Order is the same for in-app, API (GET lists/{id}/tasks), and Telegram/chat (task_find with list_id).
    """
    lst = get_list(list_id)
    if not lst:
        return []
    qd_raw = lst.get("query_definition")
    if isinstance(qd_raw, str):
        try:
            qd = json.loads(qd_raw)
        except json.JSONDecodeError:
            return []
    else:
        qd = qd_raw
    if not qd or not isinstance(qd, dict):
        return []

    conn = get_connection()
    try:
        params: list[Any] = []
        where = _compile_ast(qd, params, tz_name, conn)
        params.append(limit)
        sql = f"SELECT t.* FROM tasks t WHERE {where} LIMIT ?"
        rows = conn.execute(sql, params).fetchall()
        tasks = [_task_row_to_dict(r) for r in rows]
        task_ids = [t["id"] for t in tasks if t.get("id")]
        placeholders = ",".join("?" * len(task_ids)) if task_ids else ""
        depends_on_by: dict[str, list[str]] = {tid: [] for tid in task_ids}
        blocks_by: dict[str, list[str]] = {tid: [] for tid in task_ids}
        if task_ids:
            for row in conn.execute(
                f"SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN ({placeholders})",
                task_ids,
            ).fetchall():
                depends_on_by.setdefault(row[0], []).append(row[1])
            for row in conn.execute(
                f"SELECT depends_on_task_id, task_id FROM task_dependencies WHERE depends_on_task_id IN ({placeholders})",
                task_ids,
            ).fetchall():
                blocks_by.setdefault(row[0], []).append(row[1])
            blocked_task_ids = {
                row[0]
                for row in conn.execute(
                    f"""SELECT d.task_id FROM task_dependencies d
                        INNER JOIN tasks dep ON dep.id = d.depends_on_task_id
                        WHERE d.task_id IN ({placeholders}) AND (dep.status IS NULL OR dep.status != 'complete')""",
                    task_ids,
                ).fetchall()
            }
        else:
            blocked_task_ids = set()
        for t in tasks:
            tid = t.get("id")
            if tid:
                projs = conn.execute("SELECT project_id FROM task_projects WHERE task_id = ?", (tid,)).fetchall()
                t["projects"] = [p[0] for p in projs]
                tags_rows = conn.execute("SELECT tag FROM task_tags WHERE task_id = ?", (tid,)).fetchall()
                t["tags"] = [r[0] for r in tags_rows]
                t["depends_on"] = depends_on_by.get(tid, [])
                t["blocks"] = blocks_by.get(tid, [])
                t["is_blocked"] = tid in blocked_task_ids
            else:
                t["projects"] = []
                t["tags"] = []
                t["depends_on"] = []
                t["blocks"] = []
                t["is_blocked"] = False

        sort_def = lst.get("sort_definition")
        if isinstance(sort_def, str):
            try:
                sort_def = json.loads(sort_def)
            except json.JSONDecodeError:
                sort_def = None
        tasks = _apply_sort(tasks, sort_def)
        return tasks
    finally:
        conn.close()
