#!/usr/bin/env bash
#
# Restarts the local-harness gateway (stop, then start). Use this after
# editing gateway.js or bridge.js, since Node does not hot-reload source
# changes — the running process keeps executing whatever code it started with.
#
# Usage: same arguments as start.sh, e.g. ./restart.sh 4500
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/stop.sh"
"$DIR/start.sh" "$@"
