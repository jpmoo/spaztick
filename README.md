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

- Web UI: http://localhost:8081 (configurable in the UI).
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

1. Open http://localhost:8081 (or the port you set).
2. **Ollama**: Set URL (e.g. `http://localhost`) and port (default 11434). Click **Refresh models** to load the model list, then choose a model. Set the **system message** if desired.
3. **Telegram**: Paste your bot token. Use **long polling** (default, recommended):
   - Leave **Use long polling** checked. No port, no public URL, no HTTPS. The bot pulls updates from Telegram—ideal for a single server or home.
   - Only uncheck for **webhook** if you have a public HTTPS URL and want Telegram to push updates (e.g. high traffic).
4. Click **Save config**, then **Restart Telegram service** so the bot picks up the new settings.

Config is stored in `config.json` in the project directory.

## Start on reboot (macOS)

Use launchd so the web app (and Telegram bot subprocess) start after login:

1. **Edit the plist path** if your project is not in `~/Documents/Misc/Scripts/spaztick`: open `com.spaztick.plist` and replace `/Users/jpmoore/Documents/Misc/Scripts/spaztick` with your project path in `ProgramArguments`, `WorkingDirectory`, and the log paths.

2. **Install and enable:**
   ```bash
   cp com.spaztick.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.spaztick.plist
   ```

3. **Useful commands:**
   - Stop: `launchctl unload ~/Library/LaunchAgents/com.spaztick.plist`
   - Start again: `launchctl load ~/Library/LaunchAgents/com.spaztick.plist`
   - Logs: `tail -f /path/to/spaztick/spaztick-launchd.log`

The job runs `python -m run` (same as the web + Telegram process) with **KeepAlive**, so launchd will restart it if it exits. You can still use `./start.sh` for manual runs (e.g. to force a clean restart and free the port).

## Linux service (systemd) — start at boot (headless Ubuntu)

Runs the web UI and Telegram bot as a systemd service that starts automatically at boot.

1. **Edit the unit file** with your install path and user:
   ```bash
   # From your spaztick repo directory on the server:
   sudo cp spaztick.service /etc/systemd/system/
   sudo sed -i "s|/path/to/spaztick|$(pwd)|g" /etc/systemd/system/spaztick.service
   # If your username is not 'ubuntu', fix the User= line:
   sudo sed -i "s/^User=.*/User=$USER/" /etc/systemd/system/spaztick.service
   ```

2. **Enable and start** (enable = start at every boot):
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable spaztick
   sudo systemctl start spaztick
   ```

3. **Useful commands:**
   - Logs: `journalctl -u spaztick -f`
   - Status: `sudo systemctl status spaztick`
   - Restart: `sudo systemctl restart spaztick`
   - Stop / disable at boot: `sudo systemctl stop spaztick` and `sudo systemctl disable spaztick`

The service uses your `.venv` and runs `python -m run` (web UI + Telegram bot). It restarts automatically if it crashes. Config is in `config.json` in the project directory.

## API (for automation)

- `GET /api/config` – current config (JSON)
- `PUT /api/config` – update config (JSON body)
- `GET /api/models` – list Ollama models
- `POST /api/restart-telegram` – restart the Telegram bot subprocess
- `GET /api/telegram-status` – `{ "running": true|false, "pid": number|null }`
