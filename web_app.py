"""Web UI and API for spaztick configuration."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

# Ensure project root on path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import load as load_config
from ollama_client import OllamaClient

# Bootstrap SQLite database on first run
try:
    from task_service import ensure_db
    ensure_db()
except Exception:
    pass

app = FastAPI(title="Spaztick Config", version="1.0")

# Subprocess handle for Telegram bot (None when not running)
_telegram_process: subprocess.Popen | None = None


# --- API schemas ---


class ConfigUpdate(BaseModel):
    ollama_url: str = "http://localhost"
    ollama_port: int = Field(11434, ge=1, le=65535)
    model: str = "llama3.2"
    user_name: str = ""
    system_message: str = "You are a helpful assistant."
    telegram_bot_token: str = ""
    telegram_allowed_users: str = ""
    telegram_listener_port: int = Field(8443, ge=1, le=65535)
    webhook_public_url: str = ""
    web_ui_port: int = Field(8081, ge=1, le=65535)
    use_polling: bool = True
    database_path: str = ""
    user_timezone: str = "UTC"
    api_key: str = ""


# --- API routes ---


@app.get("/api/config", response_model=ConfigUpdate)
def get_config() -> ConfigUpdate:
    c = load_config()
    return ConfigUpdate(
        ollama_url=c.ollama_url,
        ollama_port=c.ollama_port,
        model=c.model,
        user_name=c.user_name or "",
        system_message=c.system_message,
        telegram_bot_token=c.telegram_bot_token if c.telegram_bot_token else "",
        telegram_allowed_users=getattr(c, "telegram_allowed_users", "") or "",
        telegram_listener_port=c.telegram_listener_port,
        webhook_public_url=c.webhook_public_url or "",
        web_ui_port=c.web_ui_port,
        use_polling=c.use_polling,
        database_path=getattr(c, "database_path", "") or "",
        user_timezone=getattr(c, "user_timezone", "") or "UTC",
        api_key=getattr(c, "api_key", "") or "",
    )


@app.put("/api/config")
def put_config(body: ConfigUpdate) -> dict[str, str]:
    c = load_config()
    c.ollama_url = body.ollama_url
    c.ollama_port = body.ollama_port
    c.model = body.model
    c.user_name = body.user_name
    c.system_message = body.system_message
    c.telegram_bot_token = body.telegram_bot_token
    c.telegram_allowed_users = getattr(body, "telegram_allowed_users", "") or ""
    c.telegram_listener_port = body.telegram_listener_port
    c.webhook_public_url = body.webhook_public_url
    c.web_ui_port = body.web_ui_port
    c.use_polling = body.use_polling
    c.database_path = getattr(body, "database_path", "") or ""
    c.user_timezone = getattr(body, "user_timezone", "") or "UTC"
    c.api_key = getattr(body, "api_key", "") or ""
    c.save()
    return {"status": "saved"}


@app.get("/api/models")
def list_models() -> list[dict[str, str]]:
    c = load_config()
    try:
        client = OllamaClient(c.ollama_base_url)
        models = client.list_models()
        return [{"name": m.name} for m in models]
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/restart-telegram")
def restart_telegram() -> dict[str, str]:
    global _telegram_process
    if _telegram_process is not None:
        _telegram_process.terminate()
        try:
            _telegram_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _telegram_process.kill()
        _telegram_process = None
    script = Path(__file__).resolve().parent / "telegram_bot.py"
    _telegram_process = subprocess.Popen(
        [sys.executable, str(script)],
        cwd=str(script.parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return {"status": "restarted", "pid": _telegram_process.pid}


@app.get("/api/telegram-status")
def telegram_status() -> dict[str, bool | int | None]:
    global _telegram_process
    if _telegram_process is None:
        return {"running": False, "pid": None}
    ret = _telegram_process.poll()
    if ret is not None:
        _telegram_process = None
        return {"running": False, "pid": None}
    return {"running": True, "pid": _telegram_process.pid}


class PendingConfirmBody(BaseModel):
    """Payload for executing a pending delete confirmation (e.g. from Telegram when history is off)."""
    tool: str  # "delete_task" | "delete_project"
    number: int | None = None
    short_id: str | None = None


@app.post("/api/execute-pending-confirm")
def execute_pending_confirm(body: PendingConfirmBody) -> dict[str, bool | str]:
    """Execute a pending delete (task or project). Used by Telegram bot when user replies 'yes' and history is disabled."""
    if body.tool == "delete_task":
        if body.number is None:
            return {"ok": False, "message": "delete_task requires number."}
        try:
            from task_service import get_task_by_number, delete_task
            task = get_task_by_number(body.number)
        except Exception as e:
            return {"ok": False, "message": str(e)}
        if not task:
            return {"ok": False, "message": f"No task {body.number}."}
        try:
            delete_task(task["id"])
            return {"ok": True, "message": f"Task {body.number} deleted."}
        except Exception as e:
            return {"ok": False, "message": str(e)}
    if body.tool == "delete_project":
        short_id = (body.short_id or "").strip()
        if not short_id:
            return {"ok": False, "message": "delete_project requires short_id."}
        try:
            from project_service import get_project_by_short_id, delete_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return {"ok": False, "message": str(e)}
        if not project:
            return {"ok": False, "message": f"No project \"{short_id}\"."}
        try:
            delete_project(project["id"])
            return {"ok": True, "message": f"Project {short_id} deleted. It has been removed from all tasks."}
        except Exception as e:
            return {"ok": False, "message": str(e)}
    return {"ok": False, "message": f"Unknown tool: {body.tool}. Use delete_task or delete_project."}


# --- Tasks API (for web app list / edit / delete) ---

@app.get("/api/tasks")
def api_list_tasks():
    try:
        from task_service import list_tasks as svc_list_tasks
        tasks = svc_list_tasks(limit=500)
        return [dict(t) for t in tasks]  # ensure plain dicts for JSON
    except Exception as e:
        logger = __import__("logging").getLogger("web_app")
        logger.exception("api_list_tasks failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tasks/{task_id}")
def api_get_task(task_id: str):
    from task_service import get_task
    t = get_task(task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return t


@app.put("/api/tasks/{task_id}")
def api_update_task(task_id: str, body: dict):
    from task_service import get_task, update_task, remove_task_project, remove_task_tag, add_task_project, add_task_tag
    t = get_task(task_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        from task_service import _UNSET
        update_task(
            task_id,
            title=body.get("title"),
            description=body.get("description"),
            notes=body.get("notes"),
            status=body.get("status"),
            priority=body.get("priority") if body.get("priority") is not None else None,
            available_date=(body.get("available_date") or None) if "available_date" in body else _UNSET,
            due_date=(body.get("due_date") or None) if "due_date" in body else _UNSET,
            flagged=body.get("flagged") if "flagged" in body else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "projects" in body:
        for pid in t.get("projects") or []:
            remove_task_project(task_id, pid)
        for pid in body.get("projects") or []:
            if str(pid).strip():
                add_task_project(task_id, str(pid).strip())
    if "tags" in body:
        for tag in t.get("tags") or []:
            remove_task_tag(task_id, tag)
        for tag in body.get("tags") or []:
            if str(tag).strip():
                add_task_tag(task_id, str(tag).strip())
    return get_task(task_id)


@app.delete("/api/tasks/{task_id}")
def api_delete_task(task_id: str):
    from task_service import delete_task
    if not delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "deleted"}


# --- Projects API ---

@app.get("/api/projects")
def api_list_projects(status: str | None = None):
    try:
        from project_service import list_projects
        return list_projects(status=status or None)
    except Exception as e:
        logger = __import__("logging").getLogger("web_app")
        logger.exception("api_list_projects failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects")
def api_create_project(body: dict):
    from project_service import create_project
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return create_project(
        name,
        description=body.get("description") or None,
        status=(body.get("status") or "active").strip() or "active",
    )


@app.get("/api/projects/{project_id}")
def api_get_project(project_id: str):
    from project_service import get_project
    p = get_project(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@app.put("/api/projects/{project_id}")
def api_update_project(project_id: str, body: dict):
    from project_service import update_project, get_project
    if get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return update_project(
        project_id,
        name=body.get("name") if "name" in body else None,
        description=body.get("description") if "description" in body else None,
        status=body.get("status") if "status" in body else None,
    ) or {}


@app.delete("/api/projects/{project_id}")
def api_delete_project(project_id: str):
    from project_service import delete_project
    if not delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}


# --- External API (authenticated; same app on 8081) ---

def _require_api_key(x_api_key: str | None = Header(None, alias="X-API-Key")) -> None:
    """Dependency: require X-API-Key header to match config. 403 if no key set; 401 if wrong."""
    c = load_config()
    key = (getattr(c, "api_key", "") or "").strip()
    if not key:
        raise HTTPException(status_code=403, detail="External API disabled. Set API key in web UI.")
    if not x_api_key or x_api_key.strip() != key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key. Use X-API-Key header.")


# External: Tasks
@app.get("/api/external/tasks", dependencies=[Depends(_require_api_key)])
def external_list_tasks(
    status: str | None = None,
    project_id: str | None = None,
    tag: str | None = None,
    due_by: str | None = None,
    available_by: str | None = None,
    title_contains: str | None = None,
    sort_by: str | None = None,
    flagged: bool | None = None,
    limit: int = 500,
):
    from task_service import list_tasks
    try:
        tasks = list_tasks(
            status=status,
            project_id=project_id,
            tag=tag,
            due_by=due_by,
            available_by=available_by,
            title_contains=title_contains,
            sort_by=sort_by,
            flagged=flagged,
            limit=min(limit, 1000),
        )
        return [dict(t) for t in tasks]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/external/tasks/{task_id_or_number}", dependencies=[Depends(_require_api_key)])
def external_get_task(task_id_or_number: str):
    from task_service import get_task, get_task_by_number
    t = get_task(task_id_or_number)
    if t is None and task_id_or_number.isdigit():
        t = get_task_by_number(int(task_id_or_number))
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return t


@app.post("/api/external/tasks", dependencies=[Depends(_require_api_key)])
def external_create_task(body: dict):
    from task_service import create_task
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    try:
        return create_task(
            title,
            description=body.get("description") or None,
            notes=body.get("notes") or None,
            status=(body.get("status") or "incomplete").strip() or "incomplete",
            priority=body.get("priority") if body.get("priority") is not None else None,
            available_date=body.get("available_date") or None,
            due_date=body.get("due_date") or None,
            projects=body.get("projects"),
            tags=body.get("tags"),
            flagged=body.get("flagged", False),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/external/tasks/{task_id}", dependencies=[Depends(_require_api_key)])
def external_update_task(task_id: str, body: dict):
    from task_service import get_task, get_task_by_number, update_task, remove_task_project, remove_task_tag, add_task_project, add_task_tag
    t = get_task(task_id)
    if t is None and task_id.isdigit():
        t = get_task_by_number(int(task_id))
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    tid = t["id"]
    try:
        from task_service import _UNSET
        update_task(
            tid,
            title=body.get("title"),
            description=body.get("description"),
            notes=body.get("notes"),
            status=body.get("status"),
            priority=body.get("priority") if body.get("priority") is not None else None,
            available_date=(body["available_date"] or None) if "available_date" in body else _UNSET,
            due_date=(body["due_date"] or None) if "due_date" in body else _UNSET,
            flagged=body.get("flagged") if "flagged" in body else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "projects" in body:
        for pid in (t.get("projects") or []):
            remove_task_project(tid, pid)
        for pid in body.get("projects") or []:
            if str(pid).strip():
                add_task_project(tid, str(pid).strip())
    if "tags" in body:
        for tag in (t.get("tags") or []):
            remove_task_tag(tid, tag)
        for tag in body.get("tags") or []:
            if str(tag).strip():
                add_task_tag(tid, str(tag).strip())
    from task_service import get_task as _get
    return _get(tid)


@app.delete("/api/external/tasks/{task_id}", dependencies=[Depends(_require_api_key)])
def external_delete_task(task_id: str):
    from task_service import get_task, get_task_by_number, delete_task
    t = get_task(task_id)
    if t is None and task_id.isdigit():
        t = get_task_by_number(int(task_id))
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if not delete_task(t["id"]):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "deleted"}


# External: Projects
@app.get("/api/external/projects", dependencies=[Depends(_require_api_key)])
def external_list_projects(status: str | None = None):
    from project_service import list_projects
    return list_projects(status=status or None)


@app.get("/api/external/projects/{project_id}", dependencies=[Depends(_require_api_key)])
def external_get_project(project_id: str):
    from project_service import get_project, get_project_by_short_id
    p = get_project(project_id)
    if p is None:
        p = get_project_by_short_id(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


@app.post("/api/external/projects", dependencies=[Depends(_require_api_key)])
def external_create_project(body: dict):
    from project_service import create_project
    name = (body.get("name") or body.get("title") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return create_project(
        name,
        description=body.get("description") or None,
        status=(body.get("status") or "active").strip() or "active",
    )


@app.put("/api/external/projects/{project_id}", dependencies=[Depends(_require_api_key)])
def external_update_project(project_id: str, body: dict):
    from project_service import update_project, get_project, get_project_by_short_id
    p = get_project(project_id) or get_project_by_short_id(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return update_project(
        p["id"],
        name=body.get("name") if "name" in body else None,
        description=body.get("description") if "description" in body else None,
        status=body.get("status") if "status" in body else None,
    ) or {}


@app.delete("/api/external/projects/{project_id}", dependencies=[Depends(_require_api_key)])
def external_delete_project(project_id: str):
    from project_service import delete_project, get_project, get_project_by_short_id
    p = get_project(project_id) or get_project_by_short_id(project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not delete_project(p["id"]):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}


# External: Chat (same flow as Telegram — orchestrator + Ollama + tools)
class ChatRequest(BaseModel):
    message: str
    model: str | None = None  # override config model if set


@app.post("/api/external/chat", dependencies=[Depends(_require_api_key)])
def external_chat(body: ChatRequest):
    from orchestrator import run_orchestrator
    from datetime import datetime
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        ZoneInfo = None
    c = load_config()
    base_url = c.ollama_base_url
    model = (body.model or c.model or "llama3.2").strip()
    system_prefix = (c.system_message or "").strip() or "You are a helpful assistant."
    tz_name = getattr(c, "user_timezone", None) or "UTC"
    try:
        if ZoneInfo is not None:
            now_str = datetime.now(ZoneInfo(tz_name)).strftime("%Y-%m-%d %H:%M")
        else:
            now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
            tz_name = "UTC"
    except Exception:
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        tz_name = "UTC"
    date_line = f"It is {now_str} in the user's time zone {tz_name}."
    if c.user_name and (c.user_name or "").strip():
        system_prefix = f"You are chatting with {c.user_name.strip()}.\n{date_line}\n\n{system_prefix}".strip()
    else:
        system_prefix = f"{date_line}\n\n{system_prefix}".strip()
    try:
        response_text, tool_used, _ = run_orchestrator(body.message.strip(), base_url, model, system_prefix, history=[])
        return {"response": response_text or "", "tool_used": tool_used}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Serve config UI ---

HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spaztick Config</title>
  <style>
    :root { --bg: #0f0f12; --card: #18181c; --border: #2a2a30; --text: #e4e4e7; --muted: #71717a; --accent: #a78bfa; --danger: #f87171; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 1.5rem; line-height: 1.5; }
    h1 { font-size: 1.5rem; margin: 0 0 1rem; color: var(--accent); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.25rem; color: var(--muted); font-size: 0.875rem; }
    input, select, textarea { width: 100%; padding: 0.5rem 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem; margin-bottom: 0.75rem; }
    textarea { min-height: 80px; resize: vertical; }
    button { background: var(--accent); color: var(--bg); border: none; padding: 0.6rem 1rem; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9375rem; }
    button:hover { filter: brightness(1.1); }
    button.secondary { background: var(--border); color: var(--text); }
    button.danger { background: var(--danger); color: #fff; }
    .row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .row > * { flex: 1; min-width: 120px; }
    .status { font-size: 0.875rem; color: var(--muted); margin-top: 0.5rem; }
    .muted { color: var(--muted); font-size: 0.875rem; }
    .status.running { color: #4ade80; }
    .error { color: var(--danger); font-size: 0.875rem; margin-top: 0.5rem; }
    .success { color: #4ade80; font-size: 0.875rem; margin-top: 0.5rem; }
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-list li { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: baseline; gap: 0.35rem; }
    .task-list li:hover { background: var(--border); }
    .task-list .flag-icon { color: var(--muted); font-size: 0.9em; user-select: none; }
    .task-list .flag-icon.flagged { color: #eab308; }
    .task-list .due-date.due-today { color: #ca8a04; font-weight: 500; }
    .task-list .due-date.overdue { color: var(--danger); font-weight: 500; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 100; }
    .modal-overlay.open { display: flex; }
    .modal { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; max-width: 480px; width: 90%; max-height: 90vh; overflow-y: auto; }
    .modal h3 { margin: 0 0 1rem; }
    .modal-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Spaztick Config</h1>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Ollama</h2>
    <div class="row">
      <div>
        <label>Ollama URL</label>
        <input type="text" id="ollama_url" placeholder="http://localhost" />
      </div>
      <div>
        <label>Port</label>
        <input type="number" id="ollama_port" min="1" max="65535" placeholder="11434" />
      </div>
    </div>
    <div>
      <label>Model</label>
      <select id="model">
        <option value="">Loading…</option>
      </select>
      <p class="status" id="models_status">Click "Refresh models" after setting URL/port.</p>
    </div>
    <div>
      <label>Your name (used as "You are chatting with {name}.")</label>
      <input type="text" id="user_name" placeholder="e.g. Jeff" />
    </div>
    <div>
      <label>System message</label>
      <textarea id="system_message" placeholder="You are a helpful assistant."></textarea>
    </div>
    <button type="button" class="secondary" id="refresh_models">Refresh models</button>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Telegram</h2>
    <p class="status" style="margin-bottom:0.75rem;">Use <strong>long polling</strong> (default): no public URL or HTTPS needed. The bot pulls updates from Telegram.</p>
    <div>
      <label>Bot token (from @BotFather)</label>
      <input type="password" id="telegram_bot_token" placeholder="123456:ABC-DEF..." autocomplete="off" />
    </div>
    <div>
      <label>Whitelist: allowed Telegram users</label>
      <input type="text" id="telegram_allowed_users" placeholder="@jpmoo, @other (comma-separated @usernames)" />
      <span class="status" style="display:block;margin-top:0.25rem;">Only these @usernames can use the bot. Leave <strong>empty</strong> to allow everyone. Otherwise non-listed users get &quot;Unauthorized&quot;. Save settings to apply.</span>
    </div>
    <div class="row">
      <div>
        <label><input type="checkbox" id="use_polling" checked /> Use long polling</label>
        <span class="status" style="display:block;margin-top:-0.5rem;">Recommended: no port or HTTPS</span>
      </div>
      <div>
        <label>Listener port (webhook only)</label>
        <input type="number" id="telegram_listener_port" min="1" max="65535" placeholder="8443" />
      </div>
    </div>
    <div id="webhook_url_row" style="display:none;">
      <label>Webhook public URL (HTTPS, e.g. https://yourdomain.com)</label>
      <input type="url" id="webhook_public_url" placeholder="https://yourdomain.com" />
    </div>
    <div class="row">
      <div>
        <label>Web UI port</label>
        <input type="number" id="web_ui_port" min="1" max="65535" placeholder="8081" />
      </div>
    </div>
    <p class="status" id="telegram_status">Telegram service: not running</p>
    <button type="button" id="restart_telegram">Restart Telegram service</button>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Database &amp; timezone</h2>
    <p class="status" style="margin-bottom:0.5rem;">SQLite path. Empty = project dir / spaztick.db</p>
    <div>
      <label>Database path (optional)</label>
      <input type="text" id="database_path" placeholder="/path/to/spaztick.db" />
    </div>
    <div>
      <label>Your timezone (for &quot;today&quot; / &quot;tomorrow&quot;)</label>
      <select id="user_timezone">
        <option value="UTC">UTC</option>
        <optgroup label="Americas">
          <option value="America/New_York">America/New_York (Eastern)</option>
          <option value="America/Chicago">America/Chicago (Central)</option>
          <option value="America/Denver">America/Denver (Mountain)</option>
          <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
          <option value="America/Phoenix">America/Phoenix (Arizona)</option>
          <option value="America/Anchorage">America/Anchorage</option>
          <option value="America/Honolulu">America/Honolulu</option>
          <option value="America/Toronto">America/Toronto</option>
          <option value="America/Vancouver">America/Vancouver</option>
          <option value="America/Edmonton">America/Edmonton</option>
          <option value="America/Winnipeg">America/Winnipeg</option>
          <option value="America/Halifax">America/Halifax</option>
          <option value="America/St_Johns">America/St_Johns</option>
          <option value="America/Sao_Paulo">America/Sao_Paulo</option>
          <option value="America/Buenos_Aires">America/Buenos_Aires</option>
        </optgroup>
        <optgroup label="Europe">
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Paris">Europe/Paris</option>
          <option value="Europe/Berlin">Europe/Berlin</option>
          <option value="Europe/Amsterdam">Europe/Amsterdam</option>
          <option value="Europe/Brussels">Europe/Brussels</option>
          <option value="Europe/Madrid">Europe/Madrid</option>
          <option value="Europe/Rome">Europe/Rome</option>
          <option value="Europe/Stockholm">Europe/Stockholm</option>
          <option value="Europe/Moscow">Europe/Moscow</option>
          <option value="Europe/Istanbul">Europe/Istanbul</option>
        </optgroup>
        <optgroup label="Asia">
          <option value="Asia/Dubai">Asia/Dubai</option>
          <option value="Asia/Kolkata">Asia/Kolkata</option>
          <option value="Asia/Bangkok">Asia/Bangkok</option>
          <option value="Asia/Singapore">Asia/Singapore</option>
          <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
          <option value="Asia/Shanghai">Asia/Shanghai</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="Asia/Seoul">Asia/Seoul</option>
        </optgroup>
        <optgroup label="Australia / Pacific">
          <option value="Australia/Sydney">Australia/Sydney</option>
          <option value="Australia/Melbourne">Australia/Melbourne</option>
          <option value="Australia/Perth">Australia/Perth</option>
          <option value="Pacific/Auckland">Pacific/Auckland</option>
          <option value="Pacific/Fiji">Pacific/Fiji</option>
        </optgroup>
        <optgroup label="Africa">
          <option value="Africa/Cairo">Africa/Cairo</option>
          <option value="Africa/Johannesburg">Africa/Johannesburg</option>
        </optgroup>
      </select>
    </div>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">External API</h2>
    <p class="status" style="margin-bottom:0.5rem;">Optional. When set, external apps can call <code>/api/external/*</code> (tasks, projects, chat) on this server. Send <code>X-API-Key: &lt;key&gt;</code> on every request. Empty = external API disabled.</p>
    <div>
      <label>API key</label>
      <input type="password" id="api_key" placeholder="Leave empty to disable" autocomplete="off" />
    </div>
  </div>

  <div class="card">
    <button type="button" id="save">Save config</button>
    <p class="success" id="save_msg" style="display:none;">Config saved.</p>
    <p class="error" id="save_err" style="display:none;"></p>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Projects</h2>
    <button type="button" class="secondary" id="new_project" style="margin-bottom:0.5rem;">New project</button>
    <p class="status" id="projects_status">Loading…</p>
    <ul class="task-list" id="project_list"></ul>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Tasks</h2>
    <p class="status" id="tasks_status">Loading…</p>
    <ul class="task-list" id="task_list"></ul>
  </div>

  <div class="modal-overlay" id="project_modal">
    <div class="modal">
      <h3>Edit project</h3>
      <input type="hidden" id="project_id" />
      <div><label>Short ID (read-only)</label><input type="text" id="project_short_id_display" readonly /></div>
      <div><label>Name</label><input type="text" id="project_name" /></div>
      <div><label>Description (markdown)</label><textarea id="project_description" rows="4"></textarea></div>
      <div><label>Status</label><select id="project_status"><option value="active">active</option><option value="archived">archived</option></select></div>
      <div><label>Created</label><input type="text" id="project_created_at" readonly /></div>
      <div><label>Updated</label><input type="text" id="project_updated_at" readonly /></div>
      <div class="modal-actions">
        <button type="button" id="project_save">Save</button>
        <button type="button" class="danger" id="project_delete">Delete</button>
        <button type="button" class="secondary" id="project_cancel">Cancel</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="task_modal">
    <div class="modal">
      <h3>Edit task</h3>
      <input type="hidden" id="task_id" />
      <div><label><input type="checkbox" id="task_flagged" /> Flagged</label></div>
      <div><label>Number (for reference)</label><input type="text" id="task_number_display" readonly /></div>
      <div><label>ID (read-only)</label><input type="text" id="task_id_display" readonly /></div>
      <div><label>Title</label><input type="text" id="task_title" /></div>
      <div><label>Description</label><textarea id="task_description"></textarea></div>
      <div><label>Notes</label><textarea id="task_notes"></textarea></div>
      <div><label>Status</label><select id="task_status"><option value="incomplete">incomplete</option><option value="complete">complete</option></select></div>
      <div><label>Priority (0-3)</label><input type="number" id="task_priority" min="0" max="3" /></div>
      <div><label>Available date</label><input type="text" id="task_available_date" placeholder="YYYY-MM-DD" /></div>
      <div><label>Due date</label><input type="text" id="task_due_date" placeholder="YYYY-MM-DD" /></div>
      <div><label>Projects</label><div id="task_projects_container"></div></div>
      <div><label>Tags (comma-separated)</label><input type="text" id="task_tags" placeholder="tag1, tag2" /></div>
      <div><label>Created</label><input type="text" id="task_created_at" readonly /></div>
      <div><label>Updated</label><input type="text" id="task_updated_at" readonly /></div>
      <div><label>Completed</label><input type="text" id="task_completed_at" readonly /></div>
      <div class="modal-actions">
        <button type="button" id="task_save">Save</button>
        <button type="button" class="danger" id="task_delete">Delete</button>
        <button type="button" class="secondary" id="task_cancel">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const usePolling = () => $('use_polling').checked;
    $('use_polling').addEventListener('change', () => { $('webhook_url_row').style.display = usePolling() ? 'none' : 'block'; });
    $('webhook_url_row').style.display = usePolling() ? 'none' : 'block';

    async function loadConfig() {
      const r = await fetch('/api/config');
      const c = await r.json();
      $('ollama_url').value = c.ollama_url || '';
      $('ollama_port').value = c.ollama_port ?? 11434;
      $('model').value = c.model || '';
      $('user_name').value = c.user_name || '';
      $('system_message').value = c.system_message || '';
      $('telegram_bot_token').value = c.telegram_bot_token || '';
      $('telegram_allowed_users').value = c.telegram_allowed_users || '';
      $('telegram_listener_port').value = c.telegram_listener_port ?? 8443;
      $('webhook_public_url').value = c.webhook_public_url || '';
      $('web_ui_port').value = c.web_ui_port ?? 8081;
      $('use_polling').checked = c.use_polling !== false;
      $('database_path').value = c.database_path || '';
      const tz = c.user_timezone || 'UTC';
      const tzSel = $('user_timezone');
      if (!Array.from(tzSel.options).some(o => o.value === tz)) {
        const opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = tz + ' (saved)';
        tzSel.insertBefore(opt, tzSel.firstChild);
      }
      tzSel.value = tz;
      $('api_key').value = c.api_key || '';
      $('webhook_url_row').style.display = usePolling() ? 'none' : 'block';
    }

    async function loadModels() {
      $('models_status').textContent = 'Loading…';
      try {
        const r = await fetch('/api/models');
        const list = await r.json();
        const sel = $('model');
        const cur = sel.value;
        sel.innerHTML = list.length ? list.map(m => `<option value="${m.name}">${m.name}</option>`).join('') : '<option value="">No models</option>';
        if (cur) sel.value = cur;
        $('models_status').textContent = list.length ? 'Models loaded.' : 'No models found. Is Ollama running?';
      } catch (e) {
        $('models_status').textContent = 'Error: ' + e.message;
        $('models_status').className = 'status error';
      }
    }

    async function refreshStatus() {
      try {
        const r = await fetch('/api/telegram-status');
        const s = await r.json();
        const el = $('telegram_status');
        el.textContent = s.running ? 'Telegram service: running (PID ' + s.pid + ')' : 'Telegram service: not running';
        el.className = 'status' + (s.running ? ' running' : '');
      } catch (_) {}
    }

    $('refresh_models').onclick = loadModels;
    $('save').onclick = async () => {
      $('save_msg').style.display = 'none';
      $('save_err').style.display = 'none';
      const body = {
        ollama_url: $('ollama_url').value.trim() || 'http://localhost',
        ollama_port: parseInt($('ollama_port').value, 10) || 11434,
        model: $('model').value.trim() || 'llama3.2',
        user_name: $('user_name').value.trim(),
        system_message: $('system_message').value.trim() || 'You are a helpful assistant.',
        telegram_bot_token: $('telegram_bot_token').value.trim(),
        telegram_allowed_users: $('telegram_allowed_users').value.trim(),
        telegram_listener_port: parseInt($('telegram_listener_port').value, 10) || 8443,
        webhook_public_url: $('webhook_public_url').value.trim(),
        web_ui_port: parseInt($('web_ui_port').value, 10) || 8081,
        use_polling: usePolling(),
        database_path: $('database_path').value.trim(),
        user_timezone: $('user_timezone').value.trim() || 'UTC',
        api_key: $('api_key').value.trim()
      };
      try {
        await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        $('save_msg').style.display = 'block';
        setTimeout(() => { $('save_msg').style.display = 'none'; }, 3000);
      } catch (e) {
        $('save_err').textContent = e.message;
        $('save_err').style.display = 'block';
      }
    };
    $('restart_telegram').onclick = async () => {
      try {
        await fetch('/api/restart-telegram', { method: 'POST' });
        await refreshStatus();
      } catch (e) {
        $('telegram_status').textContent = 'Error: ' + e.message;
        $('telegram_status').className = 'status error';
      }
    };

    let projectsList = [];
    async function loadProjects() {
      const el = $('project_list');
      const statusEl = $('projects_status');
      try {
        const r = await fetch('/api/projects');
        const contentType = r.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await r.json();
        } else {
          const text = await r.text();
          throw new Error(r.ok ? 'Invalid response' : (text || 'Request failed'));
        }
        if (!r.ok) throw new Error(data.detail || data.error || 'Request failed');
        projectsList = Array.isArray(data) ? data : [];
        statusEl.className = 'status';
        if (!projectsList.length) {
          el.innerHTML = '';
          statusEl.textContent = 'No projects yet.';
          return;
        }
        statusEl.textContent = projectsList.length + ' project(s)';
        el.innerHTML = projectsList.map(p => {
          const label = (p.short_id ? p.short_id + ': ' : '') + (p.name || '(no name)') + ' [' + (p.status || 'active') + ']';
          return '<li data-id="' + p.id + '">' + label + '</li>';
        }).join('');
        el.querySelectorAll('li').forEach(li => li.addEventListener('click', () => openProjectModal(li.dataset.id)));
      } catch (e) {
        el.innerHTML = '';
        statusEl.textContent = 'Error: ' + (e.message || 'Loading projects failed');
        statusEl.className = 'status error';
      }
    }

    function openProjectModal(id) {
      if (!id) {
        $('project_id').value = '';
        $('project_short_id_display').value = '';
        $('project_name').value = '';
        $('project_description').value = '';
        $('project_status').value = 'active';
        $('project_created_at').value = '';
        $('project_updated_at').value = '';
        $('project_modal').classList.add('open');
        return;
      }
      fetch('/api/projects/' + encodeURIComponent(id))
        .then(r => r.json())
        .then(p => {
          $('project_id').value = p.id;
          $('project_short_id_display').value = p.short_id || '';
          $('project_name').value = p.name || '';
          $('project_description').value = p.description || '';
          $('project_status').value = p.status || 'active';
          $('project_created_at').value = p.created_at || '';
          $('project_updated_at').value = p.updated_at || '';
          $('project_modal').classList.add('open');
        })
        .catch(() => { $('projects_status').textContent = 'Failed to load project'; });
    }
    $('new_project').onclick = () => openProjectModal(null);
    $('project_save').onclick = async () => {
      const id = $('project_id').value;
      const body = {
        name: $('project_name').value.trim(),
        description: $('project_description').value.trim() || null,
        status: $('project_status').value
      };
      if (!body.name) { alert('Name is required'); return; }
      try {
        if (id) {
          await fetch('/api/projects/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } else {
          await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        }
        $('project_modal').classList.remove('open');
        loadProjects();
        loadTasks();
      } catch (e) { alert('Save failed: ' + e.message); }
    };
    $('project_delete').onclick = () => {
      if (!confirm('Delete this project? Task associations will be removed.')) return;
      const id = $('project_id').value;
      if (!id) { $('project_modal').classList.remove('open'); return; }
      fetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(() => { $('project_modal').classList.remove('open'); loadProjects(); loadTasks(); })
        .catch(e => alert('Delete failed: ' + e.message));
    };
    $('project_cancel').onclick = () => $('project_modal').classList.remove('open');
    $('project_modal').addEventListener('click', (e) => { if (e.target === $('project_modal')) $('project_modal').classList.remove('open'); });

    async function loadTasks() {
      const el = $('task_list');
      const statusEl = $('tasks_status');
      try {
        const r = await fetch('/api/tasks');
        const contentType = r.headers.get('content-type') || '';
        let tasks;
        if (contentType.includes('application/json')) {
          tasks = await r.json();
        } else {
          const text = await r.text();
          throw new Error(r.ok ? 'Invalid response' : (text || 'Request failed'));
        }
        if (!r.ok) {
          throw new Error(tasks.detail || tasks.error || 'Request failed');
        }
        if (!Array.isArray(tasks) || !tasks.length) {
          el.innerHTML = '';
          statusEl.textContent = 'No tasks yet.';
          return;
        }
        statusEl.textContent = tasks.length + ' task(s)';
        const d = new Date();
        const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        el.innerHTML = tasks.slice(0, 100).map((t, i) => {
          const due = t.due_date ? ' — due ' + t.due_date : '';
          let dueClass = '';
          if (t.due_date) {
            if (t.due_date < today) dueClass = 'overdue';
            else if (t.due_date === today) dueClass = 'due-today';
          }
          const flagClass = (t.flagged === true || t.flagged === 1) ? 'flag-icon flagged' : 'flag-icon';
          const label = t.number != null ? String(t.number) : (i + 1);
          const dueSpan = due ? '<span class="due-date ' + dueClass + '">' + due + '</span>' : '';
          return '<li data-id="' + t.id + '"><span class="' + flagClass + '" title="' + (t.flagged ? 'Flagged' : 'Not flagged') + '">★</span> ' + label + '. ' + (t.title || '(no title)') + ' [' + (t.status || 'incomplete') + ']' + dueSpan + '</li>';
        }).join('');
        el.querySelectorAll('li').forEach(li => li.addEventListener('click', () => openTaskModal(li.dataset.id)));
      } catch (e) {
        el.innerHTML = '';
        statusEl.textContent = 'Error: ' + (e.message || 'Loading tasks failed');
        statusEl.className = 'status error';
      }
    }

    function openTaskModal(id) {
      fetch('/api/tasks/' + encodeURIComponent(id))
        .then(r => r.json())
        .then(t => {
          $('task_id').value = t.id;
          $('task_flagged').checked = t.flagged === true || t.flagged === 1;
          $('task_number_display').value = t.number != null ? String(t.number) : '';
          $('task_id_display').value = t.id;
          $('task_title').value = t.title || '';
          $('task_description').value = t.description || '';
          $('task_notes').value = t.notes || '';
          $('task_status').value = t.status || 'incomplete';
          $('task_priority').value = t.priority !== undefined && t.priority !== null ? t.priority : '';
          $('task_available_date').value = t.available_date || '';
          $('task_due_date').value = t.due_date || '';
          const container = $('task_projects_container');
          const taskProjectIds = t.projects || [];
          container.innerHTML = projectsList.length
            ? projectsList.map(p => '<label style="display:block;margin-bottom:0.25rem;"><input type="checkbox" data-project-id="' + p.id + '" ' + (taskProjectIds.indexOf(p.id) >= 0 ? 'checked' : '') + ' /> ' + (p.short_id || p.id) + ': ' + (p.name || '') + '</label>').join('')
            : '<span class="muted">No projects. Create one above.</span>';
          $('task_tags').value = (t.tags || []).join(', ');
          $('task_created_at').value = t.created_at || '';
          $('task_updated_at').value = t.updated_at || '';
          $('task_completed_at').value = t.completed_at || '';
          $('task_modal').classList.add('open');
        })
        .catch(() => $('tasks_status').textContent = 'Failed to load task');
    }

    $('task_save').onclick = async () => {
      const id = $('task_id').value;
      const projects = Array.from($('task_projects_container').querySelectorAll('input[data-project-id]:checked')).map(cb => cb.getAttribute('data-project-id'));
      const tags = $('task_tags').value.split(',').map(s => s.trim()).filter(Boolean);
      const av = ($('task_available_date').value || '').trim().substring(0, 10);
      const due = ($('task_due_date').value || '').trim().substring(0, 10);
      if (av && due && /^\\d{4}-\\d{2}-\\d{2}$/.test(av) && /^\\d{4}-\\d{2}-\\d{2}$/.test(due) && av > due) {
        alert('Available date cannot be after due date. Due date cannot be before available date.');
        return;
      }
      const body = {
        title: $('task_title').value.trim(),
        description: $('task_description').value.trim() || null,
        notes: $('task_notes').value.trim() || null,
        status: $('task_status').value,
        priority: $('task_priority').value === '' ? null : parseInt($('task_priority').value, 10),
        available_date: $('task_available_date').value.trim() || null,
        due_date: $('task_due_date').value.trim() || null,
        flagged: $('task_flagged').checked,
        projects,
        tags
      };
      try {
        const res = await fetch('/api/tasks/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.detail || data.message || res.statusText || 'Save failed');
          return;
        }
        $('task_modal').classList.remove('open');
        loadTasks();
      } catch (e) {
        alert('Save failed: ' + (e.message || e));
      }
    };

    $('task_delete').onclick = () => {
      if (!confirm('Delete this task? This cannot be undone.')) return;
      const id = $('task_id').value;
      fetch('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(() => {
          $('task_modal').classList.remove('open');
          loadTasks();
        })
        .catch(e => alert('Delete failed: ' + e.message));
    };

    $('task_cancel').onclick = () => $('task_modal').classList.remove('open');
    $('task_modal').addEventListener('click', (e) => { if (e.target === $('task_modal')) $('task_modal').classList.remove('open'); });

    loadConfig().then(loadModels);
    loadProjects();
    loadTasks();
    refreshStatus();
    setInterval(refreshStatus, 5000);
  </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return HTML_PAGE


def main() -> None:
    import uvicorn
    config = load_config()
    uvicorn.run(
        "web_app:app",
        host="0.0.0.0",
        port=config.web_ui_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
