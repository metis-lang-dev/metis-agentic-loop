#!/usr/bin/env bash
# setup.sh — the agentic loop's host, pinned (agentic-loop s-3ddb3e87):
# Node and pi are installed HERE (node/, node_modules/; gitignored), from the
# pinned releases below, checksums verified. Nothing global, no repo dependency.
#
#   ./setup.sh          install (idempotent)
#   ./setup.sh --check  verify the installed versions
#   ./setup.sh --link   only the link to the loop SDK's TypeScript face (pi.sh runs it at each start)
#
# extensions/sdk (gitignored) links the loop SDK's TypeScript face, the catalog the
# extensions import (./sdk/catalog.ts): the directory `python -m metis_loop_sdk.catalog ts`
# names in the installed SDK (METIS_LOOP_SDK_PY, default ../.venv/bin/python, else python3),
# so the py SDK and its TypeScript face are one install and one tag.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION=v22.23.3                   # >= 22.19 (pi's engines); released 2026-09-23
NODE_DIST="node-$NODE_VERSION-linux-x64"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.xz"
PI_VERSION=1.3.0                        # @earendil-works/pi-coding-agent; its lock pins the tree
NODE="$HERE/node/bin/node"
SDK_PY="${METIS_LOOP_SDK_PY:-$HERE/../.venv/bin/python}"
[ -x "$SDK_PY" ] || SDK_PY=python3

link() {
  local dir
  dir="$("$SDK_PY" -m metis_loop_sdk.catalog ts --json | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin)["dir"])')" ||
    { echo "setup.sh: no loop SDK with its TypeScript face in $SDK_PY (pip install -e ../metis-loop/sdk; sdk-v0.1.5 or later)" >&2; return 1; }
  [ "$(readlink "$HERE/extensions/sdk" 2>/dev/null)" = "$dir" ] || ln -sfn "$dir" "$HERE/extensions/sdk"
}

check() {
  "$NODE" --version | grep -qx "$NODE_VERSION" || { echo "node is not $NODE_VERSION" >&2; return 1; }
  v=$("$NODE" -p "require('$HERE/node_modules/@earendil-works/pi-coding-agent/package.json').version")
  [ "$v" = "$PI_VERSION" ] || { echo "pi is $v, not $PI_VERSION" >&2; return 1; }
  [ -f "$HERE/extensions/sdk/catalog.ts" ] || { echo "extensions/sdk has no catalog.ts: ./setup.sh --link" >&2; return 1; }
  echo "node $NODE_VERSION, pi $PI_VERSION, the loop SDK's TypeScript face at $(readlink "$HERE/extensions/sdk"): ok"
}
[ "${1:-}" = --check ] && { check; exit; }
[ "${1:-}" = --link ] && { link; exit; }

if [ ! -x "$NODE" ] || ! "$NODE" --version | grep -qx "$NODE_VERSION"; then
  dl="$(mktemp -d)"                     # the download in its own directory
  curl -fsSL -o "$dl/$NODE_DIST.tar.xz" "$NODE_URL"
  curl -fsSL -o "$dl/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$dl" && grep " $NODE_DIST.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$HERE/node" && mkdir -p "$HERE/node"
  tar -xJf "$dl/$NODE_DIST.tar.xz" -C "$HERE/node" --strip-components=1
  rm -rf "$dl"
fi
export PATH="$HERE/node/bin:$PATH"
cd "$HERE"
# package.json pins pi exactly; package-lock.json (committed) pins the tree and
# its integrity hashes; ci = install exactly the lock, no scripts from deps
npm ci --ignore-scripts --no-audit --no-fund
link
check
