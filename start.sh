#!/bin/bash
# Start spaztick in the background and exit immediately so the shell gets control back.
cd "$(dirname "$0")"
nohup .venv/bin/python -m run </dev/null >> spaztick.log 2>&1 &
exit 0
