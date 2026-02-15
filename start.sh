#!/bin/bash
# Start spaztick in the background. If restarting, stops existing processes and frees port 8081 first.
set -e
cd "$(dirname "$0")"
LOG=spaztick.log
touch "$LOG"

# Stop any existing run (SIGTERM first for graceful shutdown), then free port 8081
pkill -f "telegram_bot\.py" 2>/dev/null || true
pkill -f "run\.py" 2>/dev/null || true
pkill -f "python -m run" 2>/dev/null || true
sleep 4
fuser -k 8081/tcp 2>/dev/null || true
sleep 1

nohup .venv/bin/python -m run </dev/null >> "$LOG" 2>&1 &
echo "Started. Tail log: tail -f $LOG"
exit 0
