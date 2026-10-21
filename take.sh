#!/usr/bin/env bash
# take.sh — pi's catalog_take from the shell, after the session: a domain the loop made in
# DIR into another catalog DIR2 (agentic-loop s-3ddb3e87 step 3; fiction-port s-e3d0942d
# step 1; cwd-root s-ddac2cbf). Thin: the loop SDK's catalog CLI does it all — `take` (the
# domain's own files, with a README of the run: --readme-from-run DIR/.metis), its dry run
# for the diff, and `build` (the bundle). Never a commit: you read the diff, approve it,
# and commit in DIR2 yourself.
#
#   cd DIR && take.sh --into DIR2 [NAME]   DIR: the catalog a loop ran in (loop.sh, demo.sh); NAME: default lamp
#   METIS_LOOP_TAKE_INTO=DIR2              in --into's place; one of them is required (no default)
#   METIS_CATALOG=DIR                      DIR, when take.sh runs elsewhere
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"
INTO="${METIS_LOOP_TAKE_INTO:-}"
if [ "${1:-}" = --into ]; then INTO="${2:?take.sh --into DIR2 [NAME]}"; shift 2; fi
[ -n "$INTO" ] || { echo "usage: cd DIR && take.sh --into DIR2 [NAME]  (DIR2: the catalog to take the domain into; or METIS_LOOP_TAKE_INTO)" >&2; exit 2; }
[ -d "$INTO" ] || { echo "take.sh: --into $INTO: no such directory" >&2; exit 1; }
INTO="$(cd "$INTO" && pwd)"
DIR="$(cd "${METIS_CATALOG:-$PWD}" && pwd)"
[ "$INTO" != "$DIR" ] || { echo "take.sh: --into $INTO is the catalog the domain is in" >&2; exit 1; }
NAME="${1:-lamp}"
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
sdk() { "$SDK_PY" -m metis_loop_sdk.catalog --root "$INTO" "$@"; }
field() { "$SDK_PY" -c 'import json,sys; o=json.load(sys.stdin); print(o.get(sys.argv[1]) or "", end="")' "$1"; }

dry="$(sdk take "$NAME" --from "$DIR" --readme-from-run "$DIR/.metis" --dry-run --json)" ||
  { echo "take.sh: $(printf '%s' "$dry" | field error)" >&2; exit 1; }
printf '%s' "$dry" | field diff
echo
read -r -p "Take $NAME into $INTO? [y/N] " ok
[ "$ok" = y ] || [ "$ok" = Y ] || { echo "take.sh: nothing written."; exit 1; }
sdk take "$NAME" --from "$DIR" --readme-from-run "$DIR/.metis" --json > /dev/null
sdk build "$NAME" --json | field bundle
echo
echo "Taken, not committed: git -C $INTO status; commit domains/$NAME when you are satisfied (build/ and records/ are git-ignored)."
