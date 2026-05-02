#!/bin/bash
# Start Vertex Nova — with port cleanup and logging
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
PORT=3001
LOG_FILE="vertex-nova.log"

# --- Kill any process holding our port (prevents EADDRINUSE crash loop) ---
if lsof -ti :"$PORT" > /dev/null 2>&1; then
  echo "⚠️  Port $PORT in use — killing existing process..."
  lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "🏠 Starting Vertex Nova (port $PORT, logging to $LOG_FILE)"
exec node src/home-agent.js 2>&1 | tee -a "$LOG_FILE"
