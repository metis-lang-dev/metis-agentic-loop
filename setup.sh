#!/usr/bin/env bash
# setup.sh — the agentic loop's host, pinned (agentic-loop s-3ddb3e87):
# Node and pi are installed HERE (node/, node_modules/; gitignored), from the
# pinned releases below, checksums verified. Nothing global, no repo dependency.
#
#   ./setup.sh          install (idempotent)
#   ./setup.sh --check  verify the installed versions, and that the loop SDK's face resolves
#
# The extensions load the loop SDK's TypeScript face, their catalog, from where the SDK
# is installed (extensions/lib/sdk.ts: the directory `python -m metis_loop_sdk.catalog ts`
# names in METIS_LOOP_SDK_PY, which pi.sh defaults to ../.venv/bin/python, else python3):
# no copy and no link here, hosted or installed as a pi package (pi-release s-8e13f6a8),
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

face() {         # the directory the extensions load the face from (lib/sdk.ts asks the same)
  "$SDK_PY" -m metis_loop_sdk.catalog ts --json 2>/dev/null | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin)["dir"])' ||
    { echo "setup.sh: no loop SDK with its TypeScript face in $SDK_PY: pip install metispy metis-catalog metis-loop-sdk (or -e ../metis-loop/sdk)" >&2; return 1; }
}

check() {
  "$NODE" --version | grep -qx "$NODE_VERSION" || { echo "node is not $NODE_VERSION" >&2; return 1; }
  v=$("$NODE" -p "require('$HERE/node_modules/@earendil-works/pi-coding-agent/package.json').version")
  [ "$v" = "$PI_VERSION" ] || { echo "pi is $v, not $PI_VERSION" >&2; return 1; }
  local dir; dir="$(face)" || return 1
  [ -f "$dir/catalog.ts" ] || { echo "the loop SDK in $SDK_PY names $dir, which has no catalog.ts" >&2; return 1; }
  echo "node $NODE_VERSION, pi $PI_VERSION, the loop SDK's TypeScript face at $dir: ok"
}
[ "${1:-}" = --check ] && { check; exit; }

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
[ ! -L "$HERE/extensions/sdk" ] || rm "$HERE/extensions/sdk"     # the former link to the face (before 0.1.0)
check
