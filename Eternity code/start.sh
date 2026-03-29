#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$PATH:$HOME/.bun/bin"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "[Warning] OPENROUTER_API_KEY is not set."
  echo "Set it before launching Eternity Code if your provider requires it."
  echo
fi

cd "$SCRIPT_DIR"
bun dev .
