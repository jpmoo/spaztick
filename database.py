"""
SQLite database initialization and connection for Spaztick.
Self-bootstrapping: creates DB file, tables, indexes, and constraints on first run.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

# Default DB path: project directory
_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "spaztick.db"

_SCHEMA = """
-- Primary table: tasks
-- status: inbox | active | blocked | done | archived
-- priority: 0-3
-- recurrence: JSON object or NULL; recurrence_parent_id links instances in chain
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    number INTEGER UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('inbox', 'active', 'blocked', 'done', 'archived')),
    priority INTEGER CHECK (priority >= 0 AND priority <= 3),
    available_date TEXT,
    due_date TEXT,
    recurrence TEXT,
    recurrence_parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (recurrence_parent_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_available_date ON tasks(available_date);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

-- Task–project association
CREATE TABLE IF NOT EXISTS task_projects (
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (task_id, project_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_projects_project ON task_projects(project_id);

-- Task–tag association
CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (task_id, tag),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag);

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CHECK (task_id != depends_on_task_id)
);

-- History log for task events (audit / analytics)
CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    event TEXT NOT NULL,
    payload TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_timestamp ON task_history(timestamp);
"""


def get_db_path() -> Path:
    """Return the database file path (from config if available)."""
    try:
        from config import load as load_config
        c = load_config()
        path = getattr(c, "database_path", None)
        if path:
            return Path(path)
    except Exception:
        pass
    return _DEFAULT_DB_PATH


def init_database(path: Path | None = None) -> Path:
    """
    Ensure the database exists and is initialized. Creates file and all tables/indexes.
    Returns the path to the database file.
    """
    db_path = path or get_db_path()
    db_path = db_path.resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(_SCHEMA)
    # Migration: add number column if missing (must run BEFORE creating index on number)
    try:
        conn.execute("ALTER TABLE tasks ADD COLUMN number INTEGER")
        added = True
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
        added = False
    if added:
        conn.execute("""
            UPDATE tasks SET number = (
                SELECT 1 + COUNT(*) FROM tasks t2
                WHERE t2.created_at < tasks.created_at
                   OR (t2.created_at = tasks.created_at AND t2.id < tasks.id)
            )
        """)
    # Index on number (after column exists)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number)")
    conn.commit()
    conn.close()
    return db_path


def _ensure_number_column(conn: sqlite3.Connection) -> None:
    """Ensure tasks.number exists on this connection (migration). Run on every get_connection."""
    try:
        conn.execute("ALTER TABLE tasks ADD COLUMN number INTEGER")
        conn.execute("""
            UPDATE tasks SET number = (
                SELECT 1 + COUNT(*) FROM tasks t2
                WHERE t2.created_at < tasks.created_at
                   OR (t2.created_at = tasks.created_at AND t2.id < tasks.id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number)")
        conn.commit()
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        if "duplicate column" not in msg and "already exists" not in msg:
            raise


def has_number_column(conn: sqlite3.Connection) -> bool:
    """True if tasks.number exists (so we can use it in INSERT/SELECT)."""
    try:
        rows = conn.execute("PRAGMA table_info(tasks)").fetchall()
        return any(len(r) > 1 and r[1] == "number" for r in rows)
    except Exception:
        return False


def get_connection(path: Path | None = None) -> sqlite3.Connection:
    """Return a connection to the database. Call init_database first if needed."""
    db_path = path or get_db_path()
    init_database(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    _ensure_number_column(conn)  # run migration on this connection so it sees the column
    return conn


def migrate() -> Path:
    """Run database init + migrations. Use this to migrate manually: python -m database"""
    return init_database()


if __name__ == "__main__":
    p = migrate()
    print("Database migrated:", p)
