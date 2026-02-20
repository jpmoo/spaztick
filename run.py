#!/usr/bin/env python3
"""
Main entrypoint: start web UI and optionally the Telegram bot subprocess.
Run with: python run.py
Or run web only: python -m web_app
Or run Telegram bot only: python telegram_bot.py
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


def main() -> None:
    global _telegram_process
    _telegram_process = start_telegram_bot()
    if _telegram_process:
        atexit.register(stop_telegram_bot)
        signal.signal(signal.SIGTERM, lambda *_: (stop_telegram_bot(), sys.exit(0)))
        time.sleep(0.5)

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
