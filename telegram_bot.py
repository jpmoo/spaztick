"""Telegram bot: receive messages, send to Ollama, reply with response."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # Python < 3.9

# Run from project root so config and ollama_client can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))

from telegram import Update
from telegram.ext import Application, ContextTypes, CommandHandler, MessageHandler, filters

from config import load as load_config
from telegram_chats import add_known_chat

# Run migration at startup so DB has tasks.number before first message
try:
    from task_service import ensure_db
    ensure_db()
except Exception as e:
    logging.warning("Database init/migration at startup failed: %s. Run: python -m database", e)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


# Per-chat conversation history; cleared after successful tool (task_create / task_find)
_chat_histories: dict[int, list[dict[str, str]]] = {}

# When history is disabled: pending delete confirmation. Persisted to file so it survives restarts and works across workers.
_PENDING_CONFIRM_PATH = Path(__file__).resolve().parent / "telegram_pending_confirm.json"


def _load_pending_confirm() -> dict[int, dict]:
    """Load pending confirmations from file (chat_id -> payload with tool, short_id/number, user_message, assistant_response)."""
    out: dict[int, dict] = {}
    if not _PENDING_CONFIRM_PATH.exists():
        return out
    try:
        raw = _PENDING_CONFIRM_PATH.read_text()
        data = json.loads(raw) if raw.strip() else {}
        for k, v in (data or {}).items():
            if isinstance(v, dict) and v.get("tool") in ("delete_task", "delete_project", "project_archive", "project_unarchive", "tag_rename", "tag_delete"):
                try:
                    out[int(k)] = v
                except (TypeError, ValueError):
                    pass
    except Exception as e:
        logger.warning("Could not load telegram_pending_confirm.json: %s", e)
    return out


def _save_pending_confirm(pending: dict[int, dict]) -> None:
    """Write pending confirmations to file."""
    data = {str(k): v for k, v in pending.items()}
    try:
        _PENDING_CONFIRM_PATH.write_text(json.dumps(data, indent=0))
    except Exception as e:
        logger.warning("Could not save telegram_pending_confirm.json: %s", e)


def _get_pending_confirm(chat_id: int) -> dict | None:
    """Get pending confirmation for chat; use in-memory first, then file."""
    # In-memory is authoritative for this process; sync from file on read if missing
    if chat_id in _pending_confirm_inmem:
        return _pending_confirm_inmem[chat_id]
    loaded = _load_pending_confirm()
    return loaded.get(chat_id)


def _set_pending_confirm(chat_id: int, payload: dict | None) -> None:
    """Set or clear pending confirmation for chat; keep in-memory and persist to file."""
    if payload is None:
        _pending_confirm_inmem.pop(chat_id, None)
    else:
        _pending_confirm_inmem[chat_id] = payload
    _save_pending_confirm(_pending_confirm_inmem)


# In-memory cache; persisted to _PENDING_CONFIRM_PATH so "yes" works across restarts/workers
_pending_confirm_inmem: dict[int, dict] = _load_pending_confirm()


def _is_user_allowed(update: Update) -> bool:
    """True if no whitelist is set, or if the message sender's @username is in the whitelist."""
    config = load_config()
    raw = getattr(config, "telegram_allowed_users", "") or ""
    raw = (raw or "").strip()
    allowed = [u.strip().lstrip("@").lower() for u in raw.split(",") if u.strip()]
    user = update.effective_user
    username = (user.username or "").strip().lower() if user else ""
    user_id = user.id if user else None
    if not allowed:
        return True
    if not user or not username:
        logger.warning("Telegram whitelist active but sender has no @username (id=%s). Denying.", user_id)
        return False
    if username in allowed:
        return True
    logger.warning("Telegram user not in whitelist: @%s (id=%s). Replying Unauthorized.", username, user_id)
    return False


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Flush conversation history for this chat and start anew."""
    if not update.message:
        return
    if not _is_user_allowed(update):
        await update.message.reply_text("Unauthorized")
        return
    chat_id = update.message.chat.id
    add_known_chat(chat_id)
    _chat_histories[chat_id] = []
    _set_pending_confirm(chat_id, None)
    logger.info("Telegram /reset from allowed user chat_id=%s", chat_id)
    await update.message.reply_text("Conversation history cleared. Starting fresh.")


async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the conversation history currently gathered for the prompt."""
    if not update.message:
        return
    if not _is_user_allowed(update):
        await update.message.reply_text("Unauthorized")
        return
    chat_id = update.message.chat.id
    add_known_chat(chat_id)
    logger.info("Telegram /history from allowed user chat_id=%s", chat_id)
    history = _chat_histories.get(chat_id, [])
    if not history:
        await update.message.reply_text("No history yet. Conversation is empty.")
        return
    lines = []
    for i, h in enumerate(history, 1):
        role = (h.get("role") or "user").lower()
        content = (h.get("content") or "").strip()
        if not content:
            continue
        label = "User" if role == "user" else "Assistant"
        # Truncate long messages for display
        if len(content) > 200:
            content = content[:197] + "..."
        content = content.replace("\n", " ")
        lines.append(f"{i}. {label}: {content}")
    if not lines:
        await update.message.reply_text("No history yet. Conversation is empty.")
        return
    text = "History (used in prompt):\n\n" + "\n\n".join(lines)
    if len(text) > 4000:
        text = text[:3997] + "..."
    await update.message.reply_text(text)


def _run_orchestrator(
    user_message: str,
    base_url: str,
    model: str,
    system_prefix: str,
    history: list[dict[str, str]],
) -> tuple[str, bool, dict | None, bool]:
    """Sync orchestrator call (run in executor). Returns (response_text, tool_used, pending_confirm, used_fallback)."""
    from orchestrator import run_orchestrator
    return run_orchestrator(user_message, base_url, model, system_prefix, history=history, response_format="telegram")


def _execute_pending_confirm_http(web_base_url: str, payload: dict) -> tuple[bool, str]:
    """POST to web app execute-pending-confirm. Returns (ok, message)."""
    url = f"{web_base_url.rstrip('/')}/api/execute-pending-confirm"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            out = json.loads(resp.read().decode())
            return (bool(out.get("ok")), str(out.get("message", "")))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()
        except Exception:
            body = str(e)
        return (False, body or str(e))
    except Exception as e:
        return (False, str(e))


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle incoming message: run orchestrator; when history is off, use pending_confirm for delete confirmations."""
    if not update.message or not update.message.text:
        return
    config = load_config()
    if not config.telegram_bot_token:
        await update.message.reply_text("Bot token not configured. Set it in the web UI.")
        return
    if not _is_user_allowed(update):
        await update.message.reply_text("Unauthorized")
        return
    add_known_chat(update.message.chat.id)
    logger.info("Telegram message from allowed user chat_id=%s", update.message.chat.id)
    text = update.message.text.strip()
    if not text:
        await update.message.reply_text("Send a message to get a response. You can ask to create a task (e.g. \"Create a task: Buy milk\").")
        return
    chat_id = update.message.chat.id
    USE_HISTORY = False
    # When history is off: if user says yes/confirm and we have a pending delete, execute via API (no model call)
    if not USE_HISTORY:
        pending = _get_pending_confirm(chat_id)
        if pending and text.lower() in ("yes", "confirm", "y"):
            await update.message.chat.send_action("typing")
            web_base = f"http://127.0.0.1:{getattr(config, 'web_ui_port', 8081)}"
            loop = asyncio.get_event_loop()
            ok, msg = await loop.run_in_executor(None, lambda: _execute_pending_confirm_http(web_base, pending))
            _set_pending_confirm(chat_id, None)
            await update.message.reply_text(msg)
            return
        if pending and text.lower() in ("no", "n", "cancel"):
            _set_pending_confirm(chat_id, None)
            await update.message.reply_text("Cancelled.")
            return
    history = _chat_histories.get(chat_id, []) if USE_HISTORY else []
    if USE_HISTORY:
        history = list(history)
        history.append({"role": "user", "content": text})
    await update.message.chat.send_action("typing")
    base_url = config.ollama_base_url
    model = config.model
    system_prefix = config.system_message.strip() or ""
    tz_name = getattr(config, "user_timezone", None) or "UTC"
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
    if config.user_name and config.user_name.strip():
        system_prefix = f"You are chatting with {config.user_name.strip()}.\n{date_line}\n\n{system_prefix}".strip()
    else:
        system_prefix = f"{date_line}\n\n{system_prefix}".strip()
    effective_history = history if USE_HISTORY else []
    try:
        loop = asyncio.get_event_loop()
        response, tool_used, pending_confirm, used_fallback = await loop.run_in_executor(
            None,
            lambda: _run_orchestrator(text, base_url, model, system_prefix, effective_history),
        )
        if pending_confirm:
            # Store context so on "yes" we can send one-turn history and let the model confirm
            _set_pending_confirm(chat_id, {
                **pending_confirm,
                "user_message": text,
                "assistant_response": response or "",
            })
        if tool_used:
            _set_pending_confirm(chat_id, None)
        if not response:
            response = "(No response)"
        await update.message.reply_text(
            response,
            parse_mode="Markdown" if "```" in (response or "") else None,
        )
        if USE_HISTORY:
            if tool_used:
                _chat_histories[chat_id] = []
            else:
                _chat_histories[chat_id] = history + [{"role": "assistant", "content": response}]
    except Exception as e:
        logger.exception("Orchestrator request failed")
        err = str(e)
        if "no such column" in err.lower() and "number" in err.lower():
            await update.message.reply_text(
                f"Database needs migrating. Run from the server: python -m database\n(Then restart the bot.)\nError: {e}"
            )
        else:
            await update.message.reply_text(f"Error: {e}")
        if USE_HISTORY:
            _chat_histories[chat_id] = history


def run_polling() -> None:
    """Run bot with long polling (no port required)."""
    config = load_config()
    if not config.telegram_bot_token:
        logger.error("telegram_bot_token not set in config. Configure via web UI.")
        sys.exit(1)
    app = (
        Application.builder()
        .token(config.telegram_bot_token)
        .get_updates_read_timeout(30)
        .get_updates_connect_timeout(10)
        .build()
    )
    app.add_handler(CommandHandler("reset", cmd_reset))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    logger.info("Starting Telegram bot (long polling)")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


async def run_webhook() -> None:
    """Run bot with webhook: Starlette server on telegram_listener_port + PTB processing queue."""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.routing import Route

    config = load_config()
    if not config.telegram_bot_token:
        logger.error("telegram_bot_token not set in config. Configure via web UI.")
        sys.exit(1)
    base_url = (config.webhook_public_url or "").rstrip("/")
    if not base_url:
        logger.error("Webhook mode requires webhook_public_url (e.g. https://yourdomain.com). Set in web UI.")
        sys.exit(1)
    webhook_url = f"{base_url}/webhook"
    if not base_url.startswith("https://"):
        logger.warning("Telegram requires HTTPS for webhooks. Use a reverse proxy with TLS.")

    application = (
        Application.builder()
        .token(config.telegram_bot_token)
        .updater(None)
        .build()
    )
    application.add_handler(CommandHandler("reset", cmd_reset))
    application.add_handler(CommandHandler("history", cmd_history))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    async def telegram_webhook(request: Request) -> Response:
        data = await request.json()
        await application.update_queue.put(Update.de_json(data=data, bot=application.bot))
        return Response(status_code=200)

    starlette_app = Starlette(
        routes=[Route("/webhook", telegram_webhook, methods=["POST"])]
    )

    await application.bot.set_webhook(url=webhook_url, allowed_updates=Update.ALL_TYPES)
    logger.info("Webhook set to %s, listening on 0.0.0.0:%s", webhook_url, config.telegram_listener_port)

    config_obj = uvicorn.Config(
        starlette_app,
        host="0.0.0.0",
        port=config.telegram_listener_port,
        log_level="info",
    )
    server = uvicorn.Server(config=config_obj)
    async with application:
        await application.start()
        await server.serve()
        await application.stop()


def main() -> None:
    """Run the Telegram bot (polling or webhook). Loads config from file."""
    config = load_config()
    if config.use_polling:
        run_polling()
    else:
        asyncio.run(run_webhook())


if __name__ == "__main__":
    main()
