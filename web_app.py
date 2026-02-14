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

app = FastAPI(title="Spaztick Config", version="1.0")

# Subprocess handle for Telegram bot (None when not running)
_telegram_process: subprocess.Popen | None = None


# --- API schemas ---


class ConfigUpdate(BaseModel):
    ollama_url: str = "http://localhost"
    ollama_port: int = Field(11434, ge=1, le=65535)
    model: str = "llama3.2"
    system_message: str = "You are a helpful assistant."
    telegram_bot_token: str = ""
    telegram_listener_port: int = Field(8443, ge=1, le=65535)
    webhook_public_url: str = ""
    web_ui_port: int = Field(8080, ge=1, le=65535)
    use_polling: bool = True


# --- API routes ---


@app.get("/api/config", response_model=ConfigUpdate)
def get_config() -> ConfigUpdate:
    c = load_config()
    return ConfigUpdate(
        ollama_url=c.ollama_url,
        ollama_port=c.ollama_port,
        model=c.model,
        system_message=c.system_message,
        telegram_bot_token=c.telegram_bot_token if c.telegram_bot_token else "",
        telegram_listener_port=c.telegram_listener_port,
        webhook_public_url=c.webhook_public_url or "",
        web_ui_port=c.web_ui_port,
        use_polling=c.use_polling,
    )


@app.put("/api/config")
def put_config(body: ConfigUpdate) -> dict[str, str]:
    c = load_config()
    c.ollama_url = body.ollama_url
    c.ollama_port = body.ollama_port
    c.model = body.model
    c.system_message = body.system_message
    c.telegram_bot_token = body.telegram_bot_token
    c.telegram_listener_port = body.telegram_listener_port
    c.webhook_public_url = body.webhook_public_url
    c.web_ui_port = body.web_ui_port
    c.use_polling = body.use_polling
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
      <label>System message</label>
      <textarea id="system_message" placeholder="You are a helpful assistant."></textarea>
    </div>
    <button type="button" class="secondary" id="refresh_models">Refresh models</button>
  </div>

  <div class="card">
    <h2 style="margin:0 0 0.75rem; font-size:1.1rem;">Telegram</h2>
    <div>
      <label>Bot token (from @BotFather)</label>
      <input type="password" id="telegram_bot_token" placeholder="123456:ABC-DEF..." autocomplete="off" />
    </div>
    <div class="row">
      <div>
        <label>Listener port (webhook)</label>
        <input type="number" id="telegram_listener_port" min="1" max="65535" placeholder="8443" />
      </div>
      <div>
        <label><input type="checkbox" id="use_polling" checked /> Use long polling (no port/HTTPS needed)</label>
      </div>
    </div>
    <div id="webhook_url_row" style="display:none;">
      <label>Webhook public URL (HTTPS, e.g. https://yourdomain.com)</label>
      <input type="url" id="webhook_public_url" placeholder="https://yourdomain.com" />
    </div>
    <div class="row">
      <div>
        <label>Web UI port</label>
        <input type="number" id="web_ui_port" min="1" max="65535" placeholder="8080" />
      </div>
    </div>
    <p class="status" id="telegram_status">Telegram service: not running</p>
    <button type="button" id="restart_telegram">Restart Telegram service</button>
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
      $('system_message').value = c.system_message || '';
      $('telegram_bot_token').value = c.telegram_bot_token || '';
      $('telegram_listener_port').value = c.telegram_listener_port ?? 8443;
      $('webhook_public_url').value = c.webhook_public_url || '';
      $('web_ui_port').value = c.web_ui_port ?? 8080;
      $('use_polling').checked = c.use_polling !== false;
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
        system_message: $('system_message').value.trim() || 'You are a helpful assistant.',
        telegram_bot_token: $('telegram_bot_token').value.trim(),
        telegram_listener_port: parseInt($('telegram_listener_port').value, 10) || 8443,
        webhook_public_url: $('webhook_public_url').value.trim(),
        web_ui_port: parseInt($('web_ui_port').value, 10) || 8080,
        use_polling: usePolling()
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
