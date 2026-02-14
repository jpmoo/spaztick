# Spaztick

Telegram ↔ Ollama bridge: receive Telegram messages, send them as prompts to a local Ollama instance, and reply with the model output. Includes a web UI for configuration.

## Features

- **Telegram bot**: Receives messages, forwards them to Ollama (localhost:11434 by default), replies with the model response.
- **Web config UI**: Configure Ollama URL/port, model (with list from Ollama), system message, Telegram bot token, listener port, and restart the Telegram service.

## Requirements

- Python 3.10+
- [Ollama](https://ollama.com) running (e.g. `ollama serve` and at least one model pulled)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Install

```bash
cd /path/to/spaztick
python3 -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## Run

**All-in-one (web UI + Telegram bot):**

```bash
python run.py
```

- Web UI: http://localhost:8080 (configurable in the UI).
- Telegram bot runs as a subprocess; use **Restart Telegram service** in the UI after changing token or mode.

**Web UI only:**

```bash
python -m web_app
```

**Telegram bot only** (e.g. when you run the bot in a separate process or systemd):

```bash
python telegram_bot.py
```

## Configuration (Web UI)

1. Open http://localhost:8080 (or the port you set).
2. **Ollama**: Set URL (e.g. `http://localhost`) and port (default 11434). Click **Refresh models** to load the model list, then choose a model. Set the **system message** if desired.
3. **Telegram**: Paste your bot token. Choose:
   - **Use long polling** (default): No port or HTTPS needed; the bot pulls updates from Telegram. Easiest for development and home use.
   - **Webhook**: Set **Listener port** (e.g. 8443; Telegram allows 80, 88, 443, 8443) and **Webhook public URL** (your public HTTPS base URL, e.g. `https://yourdomain.com`). You need a reverse proxy (e.g. nginx) with TLS in front of this port.
4. Click **Save config**, then **Restart Telegram service** so the bot picks up the new settings.

Config is stored in `config.json` in the project directory.

## Linux service (systemd)

1. Copy and edit the unit file:
   ```bash
   sudo cp spaztick.service /etc/systemd/system/
   sudo sed -i "s|/path/to/spaztick|$(pwd)|" /etc/systemd/system/spaztick.service
   # Optional: set User=youruser
   ```
2. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable spaztick
   sudo systemctl start spaztick
   ```
3. Logs: `journalctl -u spaztick -f`

The service runs `python run.py`, which starts both the web UI and the Telegram bot subprocess. Restart the service after changing the config file if you prefer not to use the **Restart Telegram service** button.

## API (for automation)

- `GET /api/config` – current config (JSON)
- `PUT /api/config` – update config (JSON body)
- `GET /api/models` – list Ollama models
- `POST /api/restart-telegram` – restart the Telegram bot subprocess
- `GET /api/telegram-status` – `{ "running": true|false, "pid": number|null }`
