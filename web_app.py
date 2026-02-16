"""Web UI and API for spaztick configuration."""
from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
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
logger = logging.getLogger("spaztick.api")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """When config.debug is True, log API request method and path."""
    try:
        c = load_config()
        if getattr(c, "debug", False):
            qs = request.url.query
            logger.warning("[API] %s %s%s", request.method, request.url.path, "?" + qs if qs else "")
    except Exception:
        pass
    response = await call_next(request)
    try:
        c = load_config()
        if getattr(c, "debug", False):
            logger.warning("[API] %s %s -> %s", request.method, request.url.path, response.status_code)
    except Exception:
        pass
    return response


# Subprocess handle for Telegram bot (None when not running)
_telegram_process: subprocess.Popen | None = None


# --- API schemas ---


class ConfigUpdate(BaseModel):
    debug: bool = False
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
        debug=getattr(c, "debug", False),
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
    c.debug = getattr(body, "debug", False)
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


def _execute_pending_confirm_payload(payload: dict) -> tuple[bool, str]:
    """Run delete from pending payload. Returns (ok, message)."""
    tool = payload.get("tool")
    if tool == "delete_task":
        num = payload.get("number")
        if num is None:
            return (False, "delete_task requires number.")
        try:
            from task_service import get_task_by_number, delete_task
            task = get_task_by_number(num)
        except Exception as e:
            return (False, str(e))
        if not task:
            return (False, f"No task {num}.")
        try:
            delete_task(task["id"])
            return (True, f"Task {num} deleted.")
        except Exception as e:
            return (False, str(e))
    if tool == "delete_project":
        short_id = (payload.get("short_id") or "").strip()
        if not short_id:
            return (False, "delete_project requires short_id.")
        try:
            from project_service import get_project_by_short_id, delete_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (False, str(e))
        if not project:
            return (False, f"No project \"{short_id}\".")
        try:
            delete_project(project["id"])
            return (True, f"Project {short_id} deleted. It has been removed from all tasks.")
        except Exception as e:
            return (False, str(e))
    return (False, f"Unknown tool: {tool}. Use delete_task or delete_project.")


# Pending confirm per API key for external chat (no history): when user says "yes" we execute
_external_pending: dict[str, dict] = {}


@app.post("/api/execute-pending-confirm")
def execute_pending_confirm(body: PendingConfirmBody) -> dict[str, bool | str]:
    """Execute a pending delete (task or project). Used by Telegram bot when user replies 'yes' and history is disabled."""
    payload = {"tool": body.tool, "number": body.number, "short_id": body.short_id}
    ok, message = _execute_pending_confirm_payload(payload)
    return {"ok": ok, "message": message}


# --- Tasks API (for web app list / edit / delete) ---

@app.post("/api/tasks/normalize-priorities")
def api_normalize_task_priorities():
    """Set priority to 0 for all tasks with null priority. Returns count updated."""
    from task_service import normalize_task_priorities
    try:
        n = normalize_task_priorities()
        return {"updated": n}
    except Exception as e:
        logger = __import__("logging").getLogger("web_app")
        logger.exception("api_normalize_task_priorities failed")
        raise HTTPException(status_code=500, detail=str(e))


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
            priority=body["priority"] if "priority" in body else _UNSET,
            available_date=(body.get("available_date") or None) if "available_date" in body else _UNSET,
            due_date=(body.get("due_date") or None) if "due_date" in body else _UNSET,
            flagged=body.get("flagged") if "flagged" in body else None,
            recurrence=body["recurrence"] if "recurrence" in body else _UNSET,
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
    inbox: bool = False,
    tag: str | None = None,
    due_by: str | None = None,
    available_by: str | None = None,
    title_contains: str | None = None,
    sort_by: str | None = None,
    flagged: bool | None = None,
    priority: int | None = None,
    limit: int = 500,
):
    """List tasks. Use project_id for a project's short_id or id. Use inbox=true (or project_id=inbox) for tasks with no project."""
    from task_service import list_tasks
    use_inbox = inbox or (project_id and str(project_id).strip().lower() == "inbox")
    pid = None if use_inbox else project_id
    try:
        tasks = list_tasks(
            status=status,
            project_id=pid,
            inbox=use_inbox,
            tag=tag,
            due_by=due_by,
            available_by=available_by,
            title_contains=title_contains,
            sort_by=sort_by,
            flagged=flagged,
            priority=priority,
            limit=min(limit, 1000),
        )
        return [dict(t) for t in tasks]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/external/tasks/normalize-priorities", dependencies=[Depends(_require_api_key)])
def external_normalize_task_priorities():
    """Set priority to 0 for all tasks with null priority. Returns count updated. Call from Electron app on load."""
    from task_service import normalize_task_priorities
    try:
        n = normalize_task_priorities()
        return {"updated": n}
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
            recurrence=body.get("recurrence") if "recurrence" in body else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/external/tasks/{task_id}", dependencies=[Depends(_require_api_key)])
async def external_update_task(task_id: str, request: Request):
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {e}") from e
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    if getattr(load_config(), "debug", False):
        logger.warning("[API] PUT /api/external/tasks/%s body keys: %s, recurrence in body: %s, body: %s",
                       task_id, list(body.keys()), "recurrence" in body, body)
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
            priority=body["priority"] if "priority" in body else _UNSET,
            available_date=(body["available_date"] or None) if "available_date" in body else _UNSET,
            due_date=(body["due_date"] or None) if "due_date" in body else _UNSET,
            flagged=body.get("flagged") if "flagged" in body else None,
            recurrence=body["recurrence"] if "recurrence" in body else _UNSET,
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
    out = _get(tid)
    if getattr(load_config(), "debug", False):
        logger.warning("[API] PUT /api/external/tasks/%s response task recurrence: %s", task_id, out.get("recurrence") if out else None)
    return out


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


# External: Saved lists
@app.get("/api/external/lists", dependencies=[Depends(_require_api_key)])
def external_list_lists():
    from list_service import list_lists
    return list_lists()


@app.get("/api/external/lists/{list_id}", dependencies=[Depends(_require_api_key)])
def external_get_list(list_id: str):
    from list_service import get_list
    lst = get_list(list_id)
    if lst is None:
        raise HTTPException(status_code=404, detail="List not found")
    return lst


@app.get("/api/external/lists/{list_id}/tasks", dependencies=[Depends(_require_api_key)])
def external_list_tasks(list_id: str, limit: int = 500):
    from list_service import get_list, run_list
    from config import load as load_config
    lst = get_list(list_id)
    if lst is None:
        raise HTTPException(status_code=404, detail="List not found")
    tz_name = getattr(load_config(), "user_timezone", None) or "UTC"
    tasks = run_list(list_id, limit=min(max(1, limit), 1000), tz_name=tz_name)
    return tasks


@app.post("/api/external/lists", dependencies=[Depends(_require_api_key)])
def external_create_list(body: dict):
    from list_service import create_list
    name = (body.get("name") or body.get("title") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    query_definition = body.get("query_definition")
    if query_definition is None:
        raise HTTPException(status_code=400, detail="query_definition is required")
    return create_list(
        name,
        description=body.get("description") or None,
        query_definition=query_definition,
        sort_definition=body.get("sort_definition"),
        list_id=body.get("id"),
    )


@app.put("/api/external/lists/{list_id}", dependencies=[Depends(_require_api_key)])
def external_update_list(list_id: str, body: dict):
    from list_service import update_list, get_list
    lst = get_list(list_id)
    if lst is None:
        raise HTTPException(status_code=404, detail="List not found")
    updated = update_list(
        list_id,
        name=body.get("name") if "name" in body else None,
        description=body.get("description") if "description" in body else None,
        query_definition=body.get("query_definition") if "query_definition" in body else None,
        sort_definition=body.get("sort_definition") if "sort_definition" in body else None,
    )
    return updated or {}


@app.delete("/api/external/lists/{list_id}", dependencies=[Depends(_require_api_key)])
def external_delete_list(list_id: str):
    from list_service import delete_list, get_list
    if get_list(list_id) is None:
        raise HTTPException(status_code=404, detail="List not found")
    if not delete_list(list_id):
        raise HTTPException(status_code=404, detail="List not found")
    return {"status": "deleted"}


# External: Chat (same flow as Telegram — orchestrator + Ollama + tools)
class ChatRequest(BaseModel):
    message: str
    model: str | None = None  # override config model if set


@app.post("/api/external/chat", dependencies=[Depends(_require_api_key)])
def external_chat(request: Request, body: ChatRequest):
    from orchestrator import run_orchestrator
    from datetime import datetime
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        ZoneInfo = None
    msg = (body.message or "").strip()
    api_key = (request.headers.get("X-API-Key") or "").strip()
    # When client sends "yes"/"confirm"/"y" and we have a pending delete for this API key, execute it (no history in external chat)
    if msg.lower() in ("yes", "confirm", "y") and api_key:
        pending = _external_pending.get(api_key)
        if pending:
            _external_pending.pop(api_key, None)
            ok, response_message = _execute_pending_confirm_payload(pending)
            return {"response": response_message, "tool_used": True}
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
        response_text, tool_used, pending_confirm = run_orchestrator(msg, base_url, model, system_prefix, history=[])
        if pending_confirm and api_key:
            _external_pending[api_key] = pending_confirm
        if tool_used and api_key:
            _external_pending.pop(api_key, None)
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

    loadConfig().then(loadModels);
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
