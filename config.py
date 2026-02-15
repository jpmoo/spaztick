"""Configuration load/save for spaztick."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


class AppConfig(BaseModel):
    """Persisted application configuration."""

    ollama_url: str = Field(default="http://localhost", description="Ollama base URL (no path)")
    ollama_port: int = Field(default=11434, ge=1, le=65535)
    model: str = Field(default="llama3.2", description="Ollama model name")
    user_name: str = Field(default="", description="Name of the user chatting; prefixed to system message as 'You are chatting with {name}.'")
    system_message: str = Field(default="You are a helpful assistant.", description="System prompt for the model")
    telegram_bot_token: str = Field(default="", description="Telegram bot token from @BotFather")
    telegram_listener_port: int = Field(default=8443, ge=1, le=65535, description="Port for Telegram webhook (80, 88, 443, 8443 allowed by Telegram)")
    webhook_public_url: str = Field(default="", description="Public HTTPS URL for webhook (e.g. https://yourdomain.com), required when not using polling")
    web_ui_port: int = Field(default=8081, ge=1, le=65535, description="Port for configuration web UI")
    use_polling: bool = Field(default=True, description="Use long polling instead of webhook (no port/HTTPS needed)")
    database_path: str = Field(default="", description="Path to SQLite database file; empty = project dir / spaztick.db")
    user_timezone: str = Field(default="UTC", description="IANA timezone for relative dates (e.g. America/New_York). Used for 'today'/'tomorrow'.")

    @property
    def ollama_base_url(self) -> str:
        base = self.ollama_url.rstrip("/")
        if ":" in base.split("//")[-1]:
            return base
        return f"{base}:{self.ollama_port}"

    def to_save_dict(self) -> dict[str, Any]:
        return self.model_dump()

    @classmethod
    def load(cls) -> "AppConfig":
        if not CONFIG_PATH.exists():
            return cls()
        raw = json.loads(CONFIG_PATH.read_text())
        return cls.model_validate(raw)

    def save(self) -> None:
        CONFIG_PATH.write_text(json.dumps(self.to_save_dict(), indent=2))


def load() -> AppConfig:
    """Load config from disk. Convenience alias for AppConfig.load()."""
    return AppConfig.load()
