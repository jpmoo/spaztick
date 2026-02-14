"""Telegram bot: receive messages, send to Ollama, reply with response."""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Run from project root so config and ollama_client can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

from config import load as load_config

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


def get_ollama_response(base_url: str, model: str, prompt: str, system: str | None) -> str:
    """Sync call to Ollama (run in executor to avoid blocking async)."""
    payload = {"model": model, "prompt": prompt, "stream": False}
    if system:
        payload["system"] = system
    r = httpx.post(f"{base_url.rstrip('/')}/api/generate", json=payload, timeout=120.0)
    r.raise_for_status()
    return r.json().get("response", "")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle incoming message: send to Ollama, reply with result."""
    if not update.message or not update.message.text:
        return
    config = load_config()
    if not config.telegram_bot_token:
        await update.message.reply_text("Bot token not configured. Set it in the web UI.")
        return
    text = update.message.text.strip()
    if not text:
        await update.message.reply_text("Send a message to get a response from the model.")
        return
    await update.message.chat.send_action("typing")
    base_url = config.ollama_base_url
    model = config.model
    system_message = config.system_message.strip() or ""
    if config.user_name and config.user_name.strip():
        system_message = f"You are chatting with {config.user_name.strip()}.\n\n{system_message}".strip()
    system = system_message or None
    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: get_ollama_response(base_url, model, text, system),
        )
        if not response:
            response = "(No response from model)"
        await update.message.reply_text(response)
    except Exception as e:
        logger.exception("Ollama request failed")
        await update.message.reply_text(f"Error: {e}")


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
