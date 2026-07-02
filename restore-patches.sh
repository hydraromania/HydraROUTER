#!/bin/bash
# Script to restore all usage tracking patches after HydraROUTER update
# Run after `npm update -g hydrarouter`

echo "=== Restoring usage tracking patches ==="
echo ""

SRC="/root/router/patches/server/app/api/v1"
DST="/usr/local/lib/node_modules/hydrarouter/app/.next-cli-build/server/app/api/v1"

ENDPOINTS=(
  "chat/completions/route.js"
  "embeddings/route.js"
  "images/generations/route.js"
  "search/route.js"
  "audio/speech/route.js"
  "audio/transcriptions/route.js"
)

RESTORED=0
MISSING=0

for ep in "${ENDPOINTS[@]}"; do
  if [ -f "$SRC/$ep" ]; then
    if [ -f "$DST/$ep" ]; then
      cp "$SRC/$ep" "$DST/$ep"
      echo "✅ $ep - restored"
      RESTORED=$((RESTORED + 1))
    else
      echo "❌ $ep - DESTINATION NOT FOUND (update changed file structure?)"
      MISSING=$((MISSING + 1))
    fi
  else
    echo "⚠️  $ep - PATCH FILE NOT FOUND in $SRC"
    MISSING=$((MISSING + 1))
  fi
done

echo ""
echo "=== Summary: $RESTORED restored, $MISSING missing ==="

if [ $RESTORED -gt 0 ]; then
  echo ""
  echo "Restart HydraROUTER for changes to take effect:"
  echo "  systemctl restart hydrarouter"
fi
