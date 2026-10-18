#!/usr/bin/env bash
# take.sh — pi's catalog_take from the shell, after the session: a loop run's domain into
# the catalog (agentic-loop s-3ddb3e87 step 3; fiction-port s-e3d0942d step 1). Thin: the
# loop SDK's catalog CLI does it all — `take` (the domain's own files, with a README of
# the run: --readme-from-run), its dry run for the diff, and `build` (the bundle). Never
# a commit: you read the diff, approve it, and commit in the catalog yourself.
#
#   ./take.sh DIR [NAME]        DIR: a loop.sh --scratch (or demo.sh) run; NAME: default lamp
#   METIS_CATALOG=<root>        the catalog to take it into (default: the sibling metis-catalog)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"
DIR="$(cd "${1:?usage: take.sh DIR [NAME]  (DIR: a loop.sh --scratch run)}" && pwd)"
NAME="${2:-lamp}"
CAT="${METIS_CATALOG:-$PKGS/metis-catalog}"
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
sdk() { "$SDK_PY" -m metis_loop_sdk.catalog --root "$CAT" "$@"; }
field() { "$SDK_PY" -c 'import json,sys; o=json.load(sys.stdin); print(o.get(sys.argv[1]) or "", end="")' "$1"; }

dry="$(sdk take "$NAME" --from "$DIR/catalog" --readme-from-run "$DIR" --dry-run --json)" ||
  { echo "take.sh: $(printf '%s' "$dry" | field error)" >&2; exit 1; }
printf '%s' "$dry" | field diff
echo
read -r -p "Take $NAME into $CAT? [y/N] " ok
[ "$ok" = y ] || [ "$ok" = Y ] || { echo "take.sh: nothing written."; exit 1; }
sdk take "$NAME" --from "$DIR/catalog" --readme-from-run "$DIR" --json > /dev/null
sdk build "$NAME" --json | field bundle
echo
echo "Taken, not committed: git -C $CAT status; commit domains/$NAME when you are satisfied (build/ and records/ are git-ignored)."
