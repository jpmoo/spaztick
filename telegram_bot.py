"""Telegram bot: receive messages, send to Ollama, reply with response."""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Run from project root so config and ollama_client can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))

from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from config import load as load_config

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


# Per-chat conversation history; cleared after successful tool (task_create / task_list)
_chat_histories: dict[int, list[dict[str, str]]] = {}


def _run_orchestrator(
    user_message: str,
    base_url: str,
    model: str,
    system_prefix: str,
    history: list[dict[str, str]],
) -> tuple[str, bool]:
    """Sync orchestrator call (run in executor). Returns (response_text, tool_used)."""
    from orchestrator import run_orchestrator
    return run_orchestrator(user_message, base_url, model, system_prefix, history=history)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle incoming message: run orchestrator with history; clear history after successful tool."""
    if not update.message or not update.message.text:
        return
    config = load_config()
    if not config.telegram_bot_token:
        await update.message.reply_text("Bot token not configured. Set it in the web UI.")
        return
    text = update.message.text.strip()
    if not text:
        await update.message.reply_text("Send a message to get a response. You can ask to create a task (e.g. \"Create a task: Buy milk\").")
        return
    chat_id = update.message.chat.id
    history = _chat_histories.get(chat_id, [])
    history.append({"role": "user", "content": text})
    await update.message.chat.send_action("typing")
    base_url = config.ollama_base_url
    model = config.model
    system_prefix = config.system_message.strip() or ""
    if config.user_name and config.user_name.strip():
        system_prefix = f"You are chatting with {config.user_name.strip()}.\n\n{system_prefix}".strip()
    try:
        loop = asyncio.get_event_loop()
        response, tool_used = await loop.run_in_executor(
            None,
            lambda: _run_orchestrator(text, base_url, model, system_prefix, history),
        )
        if not response:
            response = "(No response)"
        await update.message.reply_text(response)
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
        _chat_histories[chat_id] = history


def run_polling() -> None:
    """Run bot with long polling (no port required)."""
    config = load_config()
    if not config.telegram_bot_token:
        logger.error("telegram_bot_token not set in config. Configure via web UI.")
        sys.exit(1)
    app = Application.builder().token(config.telegram_bot_token).build()
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
