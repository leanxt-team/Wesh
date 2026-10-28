#!/bin/sh
# macOS/Linux wrapper: sh install.sh [options]   (same options as node install.mjs; see sh install.sh --help)
command -v node >/dev/null 2>&1 || { echo "wesh needs Node.js 18+ (https://nodejs.org)" >&2; exit 1; }
exec node "$(dirname "$0")/install.mjs" "$@"
