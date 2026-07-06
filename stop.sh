#!/usr/bin/env bash
#
# Stops the local-harness gateway started by ./start.sh.
#
# Usage: ./stop.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/.gateway.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Gateway is not running (no pid file)."
  exit 0
fi

PID="$(cat "$PID_FILE")"

if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "Gateway is not running (stale pid file) — cleaning up."
  rm -f "$PID_FILE"
  exit 0
fi

echo "Stopping gateway (pid $PID)..."
kill "$PID"

for _ in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Gateway stopped."
    exit 0
  fi
  sleep 0.25
done

echo "Gateway didn't stop gracefully after 5s — forcing (SIGKILL)."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Gateway stopped."
