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

# Wait up to this many seconds for locks (web + Telegram often use same DB)
_CONNECT_TIMEOUT = 30.0

_SCHEMA = """
-- Primary table: tasks
-- status: incomplete | complete (new tasks are always incomplete)
-- priority: 0-3
-- recurrence: JSON object or NULL; recurrence_parent_id links instances in chain
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    number INTEGER UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('incomplete', 'complete')),
    priority INTEGER CHECK (priority >= 0 AND priority <= 3),
    available_date TEXT,
    due_date TEXT,
    recurrence TEXT,
    recurrence_parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    flagged INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (recurrence_parent_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_available_date ON tasks(available_date);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

-- Projects (id = primary key; short_id = user-friendly 1–4 alphanumeric, unique)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_projects_short_id ON projects(short_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Task–project association (project_id references projects.id)
CREATE TABLE IF NOT EXISTS task_projects (
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (task_id, project_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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

-- Saved lists: short_id (friendly 1-4 alphanumeric), name, description, query_definition (JSON AST), sort_definition (JSON), timestamps
CREATE TABLE IF NOT EXISTS saved_lists (
    id TEXT PRIMARY KEY,
    short_id TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    query_definition TEXT NOT NULL,
    sort_definition TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_lists_short_id ON saved_lists(short_id);
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
    conn = sqlite3.connect(str(db_path), timeout=_CONNECT_TIMEOUT)
    conn.execute("PRAGMA journal_mode=WAL")
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
    # Migration: status only incomplete | complete (recreate table if old CHECK exists)
    _migrate_status_to_incomplete_complete(conn)
    # Migration: add flagged column if missing
    try:
        conn.execute("ALTER TABLE tasks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
    # Migration: add short_id to saved_lists if missing (backfill done in list_service)
    try:
        conn.execute("ALTER TABLE saved_lists ADD COLUMN short_id TEXT")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise
    conn.commit()
    conn.close()
    return db_path


def _tasks_has_old_status_constraint(conn: sqlite3.Connection) -> bool:
    """True if tasks table definition still has old status CHECK (inbox/done/etc)."""
    try:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
        ).fetchone()
        if not row or not row[0]:
            return False
        sql = (row[0] or "").lower()
        return "inbox" in sql or "done" in sql or "archived" in sql
    except Exception:
        return True  # assume migration needed


def _migrate_status_to_incomplete_complete(conn: sqlite3.Connection) -> None:
    """If tasks table has old status CHECK, recreate with only incomplete|complete."""
    if not _tasks_has_old_status_constraint(conn):
        return
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("""
        CREATE TABLE tasks_new (
            id TEXT PRIMARY KEY,
            number INTEGER UNIQUE,
            title TEXT NOT NULL,
            description TEXT,
            notes TEXT,
            status TEXT NOT NULL CHECK (status IN ('incomplete', 'complete')),
            priority INTEGER CHECK (priority >= 0 AND priority <= 3),
            available_date TEXT,
            due_date TEXT,
            recurrence TEXT,
            recurrence_parent_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            flagged INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (recurrence_parent_id) REFERENCES tasks(id)
        )
    """)
    conn.execute("""
        INSERT INTO tasks_new
        SELECT id, number, title, description, notes,
               CASE WHEN status = 'done' THEN 'complete' ELSE 'incomplete' END,
               priority, available_date, due_date, recurrence, recurrence_parent_id,
               created_at, updated_at, completed_at,
               0
        FROM tasks
    """)
    conn.execute("DROP TABLE tasks")
    conn.execute("ALTER TABLE tasks_new RENAME TO tasks")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_number ON tasks(number)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_available_date ON tasks(available_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()


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
    conn = sqlite3.connect(str(db_path), timeout=_CONNECT_TIMEOUT)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    _ensure_number_column(conn)  # run migration on this connection so it sees the column
    _migrate_status_to_incomplete_complete(conn)  # ensure tasks.status is incomplete|complete
    return conn


def migrate() -> Path:
    """Run database init + migrations. Use this to migrate manually: python -m database"""
    return init_database()


if __name__ == "__main__":
    p = migrate()
    print("Database migrated:", p)
