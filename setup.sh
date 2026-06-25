#!/usr/bin/env bash
# First-time bootstrap for the DeepPhe stack.
# Safe to re-run; it creates local env defaults and starts the stack.
set -euo pipefail

# Local env defaults.
[ -f .env ] || cp .env.example .env

# Build images and start detached.
docker compose up --build -d

echo
echo "DeepPhe Visualizer:  http://localhost:${VIZ_PORT:-3000}"
echo "Logs:                docker compose logs -f"
echo "Stop:                docker compose down"
