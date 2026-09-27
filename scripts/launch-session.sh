#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.idea/chrome-session"
LOG="$ROOT/.idea/chrome-session.log"
PORT=9333
DIST="$ROOT/dist"

if [[ -x "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta" ]]; then
  CHROME="/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
elif [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  echo "chrome-missing"
  exit 1
fi

mkdir -p "$DIR"
if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "session-already-up port=${PORT} profile=${DIR}"
  echo "Finish Facebook login in that window until Marketplace shows you as signed in."
  exit 0
fi

if pgrep -f "user-data-dir=${DIR}" >/dev/null 2>&1; then
  echo "session-profile-busy: quit the other Chrome using ${DIR}, then retry"
  exit 1
fi

rm -f "$DIR/SingletonLock" "$DIR/SingletonSocket" "$DIR/SingletonCookie" 2>/dev/null || true

EXTRA=()
if [[ -f "$DIST/manifest.json" ]]; then
  EXTRA+=(
    --disable-extensions-except="$DIST"
    --load-extension="$DIST"
    --enable-unsafe-extension-debugging
  )
  echo "loading-extension=${DIST}"
else
  echo "extension-missing: run npm run build first if you need Facebook AI Agent in this window"
fi

: > "$LOG"
nohup "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-blink-features=AutomationControlled \
  "${EXTRA[@]}" \
  "https://www.facebook.com/marketplace/" \
  >> "$LOG" 2>&1 &
disown
echo $! > "$ROOT/.idea/chrome-session.pid"
sleep 5
if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null; then
  echo "session-started port=${PORT} profile=${DIR}"
  echo "Log in to Facebook in THAT window until Marketplace loads signed-in."
  echo "Then quit Chrome fully so cookies flush. Later tests reuse the same profile."
else
  echo "session-start-failed"
  head -40 "$LOG"
  exit 1
fi
