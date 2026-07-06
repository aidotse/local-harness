#!/usr/bin/env bash
#
# Starts the local-harness gateway in the background.
#
# Usage:
#   ./start.sh                 use the port saved in config.json
#   ./start.sh 4500             use port 4500 for this run only
#   ./start.sh --port 4500      same, explicit flag
#   PORT=4500 ./start.sh        same, via environment variable
#
# A custom port here does NOT change config.json — it only applies to this
# run (see gateway.js's PORT env var handling). Edit the port permanently in
# the GUI's Audit section instead.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PID_FILE="$DIR/.gateway.pid"
LOG_FILE="$DIR/logs/gateway.log"

if [ "${1:-}" = "--port" ]; then
  PORT="${2:-}"
elif [ -n "${1:-}" ]; then
  PORT="$1"
fi

if [ -n "${PORT:-}" ]; then
  if ! echo "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo "error: '$PORT' is not a valid port (1-65535)" >&2
    exit 1
  fi
fi

# Refuse to double-start; clean up a stale pid file from a crashed process.
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Gateway is already running (pid $OLD_PID)."
    echo "Run ./stop.sh first, or ./restart.sh to do both in one step."
    exit 1
  fi
  rm -f "$PID_FILE"
fi

mkdir -p "$DIR/logs"

# Figure out which port we expect it to come up on *before* launching, so
# readiness can be checked by polling that exact port — not by grepping the
# log file, which is append-only and can still contain a banner from a
# previous run.
if [ -n "${PORT:-}" ]; then
  EXPECTED_PORT="$PORT"
else
  EXPECTED_PORT="$(node -e "try{process.stdout.write(String(require('./config.json').port||4000))}catch{process.stdout.write('4000')}" 2>/dev/null || echo 4000)"
fi

if [ -n "${PORT:-}" ]; then
  echo "Starting gateway on port $PORT (this run only)..."
  PORT="$PORT" nohup node "$DIR/gateway.js" >>"$LOG_FILE" 2>&1 &
else
  echo "Starting gateway on the port from config.json..."
  nohup node "$DIR/gateway.js" >>"$LOG_FILE" 2>&1 &
fi
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

# Poll /healthz (deliberately unauthenticated) rather than /admin, which now
# requires a token and would answer 401 even once fully up.
for _ in $(seq 1 40); do
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "error: gateway exited immediately — last log lines:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$EXPECTED_PORT/healthz" 2>/dev/null || true)"
  if [ "$HTTP_CODE" = "200" ]; then
    TOKEN="$(node -e "try{process.stdout.write(require('./config.json').adminToken||'')}catch{}" 2>/dev/null || true)"
    echo "Gateway running (pid $NEW_PID)."
    echo "Admin GUI: http://localhost:$EXPECTED_PORT/admin?token=$TOKEN"
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  sleep 0.25
done

echo "error: gateway started (pid $NEW_PID) but didn't answer on port $EXPECTED_PORT in time — check $LOG_FILE" >&2
exit 1
