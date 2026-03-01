#!/usr/bin/env python3
"""
Main entrypoint: start web UI and optionally the Telegram bot and MCP server subprocesses.
Run with: python run.py
Or run web only: python -m web_app
Or run Telegram bot only: python telegram_bot.py
Or run MCP server only: python mcp_server.py
"""
from __future__ import annotations

import atexit
import logging
import signal
import subprocess
import sys
import time
from pathlib import Path

# Ensure app loggers (spaztick.api, task_service) emit to the same stream as uvicorn
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
    force=True,
)

# Project root
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from config import load as load_config

# Bootstrap SQLite database on first run
try:
    from task_service import ensure_db
    ensure_db()
except Exception:
    pass

_telegram_process: subprocess.Popen | None = None
_mcp_process: subprocess.Popen | None = None


def start_telegram_bot() -> subprocess.Popen | None:
    config = load_config()
    if not config.telegram_bot_token:
        return None
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "telegram_bot.py")],
        cwd=str(ROOT),
        stdout=None,
        stderr=None,
    )
    return proc


def stop_telegram_bot() -> None:
    global _telegram_process
    if _telegram_process is None:
        return
    _telegram_process.terminate()
    try:
        _telegram_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _telegram_process.kill()
    _telegram_process = None


def start_mcp_server() -> subprocess.Popen | None:
    """Start the MCP SSE server subprocess if mcp_port is set in config."""
    import logging
    log = logging.getLogger(__name__)
    config = load_config()
    port = getattr(config, "mcp_port", None)
    if port is None:
        log.info("MCP server not started: mcp_port not set in config")
        return None
    log.info("Starting MCP server on port %s (host=%s)", port, getattr(config, "mcp_host", "0.0.0.0"))
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "mcp_server.py")],
        cwd=str(ROOT),
        stdout=None,
        stderr=None,
    )
    time.sleep(0.5)
    if proc.poll() is not None:
        log.error("MCP server exited immediately (code=%s). Run 'python mcp_server.py' in the project dir to see the error.", proc.returncode)
        return None
    return proc


def stop_mcp_server() -> None:
    global _mcp_process
    if _mcp_process is None:
        return
    _mcp_process.terminate()
    try:
        _mcp_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _mcp_process.kill()
    _mcp_process = None


def main() -> None:
    global _telegram_process, _mcp_process
    _telegram_process = start_telegram_bot()
    if _telegram_process:
        atexit.register(stop_telegram_bot)
        time.sleep(0.5)

    _mcp_process = start_mcp_server()
    if _mcp_process:
        atexit.register(stop_mcp_server)
        time.sleep(0.3)

    if _telegram_process or _mcp_process:
        def _on_sigterm(*_args: object) -> None:
            stop_telegram_bot()
            stop_mcp_server()
            sys.exit(0)
        signal.signal(signal.SIGTERM, _on_sigterm)

    # Start scheduler for list→Telegram cron (runs in this process)
    try:
        from telegram_cron import start_telegram_cron_scheduler
        start_telegram_cron_scheduler()
    except Exception:
        pass

    # Run web app (blocking)
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
