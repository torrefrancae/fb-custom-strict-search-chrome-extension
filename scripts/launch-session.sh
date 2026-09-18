#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.idea/chrome-session"
LOG="$ROOT/.idea/chrome-session.log"
PORT=9333
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

mkdir -p "$DIR"
if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "session-already-up port=${PORT}"
  exit 0
fi

: > "$LOG"
nohup "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.facebook.com/marketplace/" \
  >> "$LOG" 2>&1 &
disown
echo $! > "$ROOT/.idea/chrome-session.pid"
sleep 5
if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "session-started port=${PORT}"
else
  echo "session-start-failed"
  cat "$LOG" | head -40
  exit 1
fi
