#!/bin/bash
# Start Vertex Nova — adjust the path to your installation
cd "$(dirname "$0")/.." || exit 1
exec node src/home-agent.js
