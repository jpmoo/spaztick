"""Web UI and API for spaztick configuration."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
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
    telegram_listener_port: int = Field(8443, ge=1, le=65535)
    webhook_public_url: str = ""
    web_ui_port: int = Field(8081, ge=1, le=65535)
    use_polling: bool = True
    database_path: str = ""
    user_timezone: str = "UTC"


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
        telegram_listener_port=c.telegram_listener_port,
        webhook_public_url=c.webhook_public_url or "",
        web_ui_port=c.web_ui_port,
        use_polling=c.use_polling,
        database_path=getattr(c, "database_path", "") or "",
        user_timezone=getattr(c, "user_timezone", "") or "UTC",
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
    c.telegram_listener_port = body.telegram_listener_port
    c.webhook_public_url = body.webhook_public_url
    c.web_ui_port = body.web_ui_port
    c.use_polling = body.use_polling
    c.database_path = getattr(body, "database_path", "") or ""
    c.user_timezone = getattr(body, "user_timezone", "") or "UTC"
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


# --- Tasks API (for web app list / edit / delete) ---

@app.get("/api/tasks")
def api_list_tasks() -> list[dict]:
    from task_service import list_tasks as svc_list_tasks
    return svc_list_tasks(limit=500)


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
    update_task(
        task_id,
        title=body.get("title"),
        description=body.get("description"),
        notes=body.get("notes"),
        status=body.get("status"),
        priority=body.get("priority") if body.get("priority") is not None else None,
        available_date=body.get("available_date") or None,
        due_date=body.get("due_date") or None,
    )
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
    .status.running { color: #4ade80; }
    .error { color: var(--danger); font-size: 0.875rem; margin-top: 0.5rem; }
    .success { color: #4ade80; font-size: 0.875rem; margin-top: 0.5rem; }
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-list li { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); cursor: pointer; }
    .task-list li:hover { background: var(--border); }
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
      <input type="text" id="user_timezone" placeholder="e.g. America/New_York or UTC" />
    </div>
  </div>

  <div class="card">
    <button type="button" id="save">Save config</button>
    <p class="success" id="save_msg" style="display:none;">Config saved.</p>
    <p class="error" id="save_err" style="display:none;"></p>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Tasks</h2>
    <p class="status" id="tasks_status">Loading…</p>
    <ul class="task-list" id="task_list"></ul>
  </div>

  <div class="modal-overlay" id="task_modal">
    <div class="modal">
      <h3>Edit task</h3>
      <input type="hidden" id="task_id" />
      <div><label>Number (for reference)</label><input type="text" id="task_number_display" readonly /></div>
      <div><label>ID (read-only)</label><input type="text" id="task_id_display" readonly /></div>
      <div><label>Title</label><input type="text" id="task_title" /></div>
      <div><label>Description</label><textarea id="task_description"></textarea></div>
      <div><label>Notes</label><textarea id="task_notes"></textarea></div>
      <div><label>Status</label><select id="task_status"><option value="inbox">inbox</option><option value="active">active</option><option value="blocked">blocked</option><option value="done">done</option><option value="archived">archived</option></select></div>
      <div><label>Priority (0-3)</label><input type="number" id="task_priority" min="0" max="3" /></div>
      <div><label>Available date</label><input type="text" id="task_available_date" placeholder="YYYY-MM-DD" /></div>
      <div><label>Due date</label><input type="text" id="task_due_date" placeholder="YYYY-MM-DD" /></div>
      <div><label>Projects (comma-separated)</label><input type="text" id="task_projects" placeholder="project1, project2" /></div>
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
      $('telegram_listener_port').value = c.telegram_listener_port ?? 8443;
      $('webhook_public_url').value = c.webhook_public_url || '';
      $('web_ui_port').value = c.web_ui_port ?? 8081;
      $('use_polling').checked = c.use_polling !== false;
      $('database_path').value = c.database_path || '';
      $('user_timezone').value = c.user_timezone || 'UTC';
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
        telegram_listener_port: parseInt($('telegram_listener_port').value, 10) || 8443,
        webhook_public_url: $('webhook_public_url').value.trim(),
        web_ui_port: parseInt($('web_ui_port').value, 10) || 8081,
        use_polling: usePolling(),
        database_path: $('database_path').value.trim(),
        user_timezone: $('user_timezone').value.trim() || 'UTC'
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

    async function loadTasks() {
      try {
        const r = await fetch('/api/tasks');
        const tasks = await r.json();
        const el = $('task_list');
        const statusEl = $('tasks_status');
        if (!tasks.length) {
          el.innerHTML = '';
          statusEl.textContent = 'No tasks yet.';
          return;
        }
        statusEl.textContent = tasks.length + ' task(s)';
        el.innerHTML = tasks.slice(0, 100).map((t, i) => {
          const due = t.due_date ? ' — due ' + t.due_date : '';
          const label = t.number != null ? '#' + t.number : (i + 1);
          return '<li data-id="' + t.id + '">' + label + '. ' + (t.title || '(no title)') + ' [' + (t.status || 'inbox') + ']' + due + '</li>';
        }).join('');
        el.querySelectorAll('li').forEach(li => li.addEventListener('click', () => openTaskModal(li.dataset.id)));
      } catch (e) {
        $('tasks_status').textContent = 'Error: ' + e.message;
        $('tasks_status').className = 'status error';
      }
    }

    function openTaskModal(id) {
      fetch('/api/tasks/' + encodeURIComponent(id))
        .then(r => r.json())
        .then(t => {
          $('task_id').value = t.id;
          $('task_number_display').value = t.number != null ? '#' + t.number : '';
          $('task_id_display').value = t.id;
          $('task_title').value = t.title || '';
          $('task_description').value = t.description || '';
          $('task_notes').value = t.notes || '';
          $('task_status').value = t.status || 'inbox';
          $('task_priority').value = t.priority !== undefined && t.priority !== null ? t.priority : '';
          $('task_available_date').value = t.available_date || '';
          $('task_due_date').value = t.due_date || '';
          $('task_projects').value = (t.projects || []).join(', ');
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
      const projects = $('task_projects').value.split(',').map(s => s.trim()).filter(Boolean);
      const tags = $('task_tags').value.split(',').map(s => s.trim()).filter(Boolean);
      const body = {
        title: $('task_title').value.trim(),
        description: $('task_description').value.trim() || null,
        notes: $('task_notes').value.trim() || null,
        status: $('task_status').value,
        priority: $('task_priority').value === '' ? null : parseInt($('task_priority').value, 10),
        available_date: $('task_available_date').value.trim() || null,
        due_date: $('task_due_date').value.trim() || null,
        projects,
        tags
      };
      try {
        await fetch('/api/tasks/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        $('task_modal').classList.remove('open');
        loadTasks();
      } catch (e) {
        alert('Save failed: ' + e.message);
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
