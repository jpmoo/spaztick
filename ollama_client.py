"""Ollama API client: list models and generate completions."""
from __future__ import annotations

import httpx
from pydantic import BaseModel


class OllamaModel(BaseModel):
    name: str
    modified_at: str = ""


class OllamaClient:
    """Sync client for Ollama API."""

    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def list_models(self) -> list[OllamaModel]:
        """Return list of available model names from Ollama."""
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=10.0)
            r.raise_for_status()
            data = r.json()
            models = data.get("models") or []
            return [OllamaModel(name=m.get("name", "").split(":")[0], modified_at=m.get("modified_at", "")) for m in models]
        except (httpx.HTTPError, KeyError) as e:
            raise RuntimeError(f"Failed to list Ollama models: {e}") from e

    def generate(self, model: str, prompt: str, system: str | None = None) -> str:
        """Send prompt to Ollama and return full response text (non-streaming)."""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system
        try:
            r = httpx.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
            r.raise_for_status()
            data = r.json()
            return data.get("response", "")
        except httpx.HTTPError as e:
            raise RuntimeError(f"Ollama generate failed: {e}") from e
