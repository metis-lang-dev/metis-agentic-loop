#!/usr/bin/env bash
# tools/pi/setup.sh — the agentic loop's host, pinned (agentic-loop s-3ddb3e87):
# Node and pi are installed HERE (node/, node_modules/; gitignored), from the
# pinned releases below, checksums verified. Nothing global, no repo dependency.
#
#   tools/pi/setup.sh          install (idempotent)
#   tools/pi/setup.sh --check  verify the installed versions
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION=v22.23.3                   # >= 22.19 (pi's engines); released 2026-09-23
NODE_DIST="node-$NODE_VERSION-linux-x64"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.xz"
PI_VERSION=1.3.0                        # @earendil-works/pi-coding-agent; its lock pins the tree
NODE="$HERE/node/bin/node"

check() {
  "$NODE" --version | grep -qx "$NODE_VERSION" || { echo "node is not $NODE_VERSION" >&2; return 1; }
  v=$("$NODE" -p "require('$HERE/node_modules/@earendil-works/pi-coding-agent/package.json').version")
  [ "$v" = "$PI_VERSION" ] || { echo "pi is $v, not $PI_VERSION" >&2; return 1; }
  echo "node $NODE_VERSION, pi $PI_VERSION: ok"
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
check
