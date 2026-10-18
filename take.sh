#!/usr/bin/env bash
# take.sh — a demo run's domain into the catalog, laid out as the dog is (agentic-loop
# s-3ddb3e87 step 3): pi's catalog_take, from the shell after the session. The run's
# catalog is a scratch one (tools/, the plant beside the lamp); this takes the one domain over through the loop SDK's catalog CLI (`take`: its
# domain.yaml, program, extensions, host, intent.yaml with intent/ generated again), adds
# a README of where it came from, and builds its bundle (build/, git-ignored). Never a
# commit: you read the diff, approve it, and commit in the catalog yourself.
#
#   ./take.sh DIR [NAME]        DIR: a demo.sh run; NAME: the domain, default lamp
#   METIS_CATALOG=<root>        the catalog to take it into (default: the sibling metis-catalog)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS="$(cd "$HERE/.." && pwd)"
DIR="$(cd "${1:?usage: take.sh DIR [NAME]  (DIR: a demo.sh run)}" && pwd)"
NAME="${2:-lamp}"
SRC="$DIR/catalog"
CAT="${METIS_CATALOG:-$PKGS/metis-catalog}"
SDK_PY="${METIS_LOOP_SDK_PY:-$PKGS/.venv/bin/python}"
[ -f "$SRC/domains/$NAME/domain.yaml" ] || { echo "take.sh: $SRC/domains/$NAME has no domain.yaml: is $DIR a demo run that applied $NAME?" >&2; exit 1; }
sdk() { "$SDK_PY" -m metis_loop_sdk.catalog --root "$CAT" "$@"; }

# the README: the run's own, else one written from what the run left (catalog_take's too)
README="$DIR/$NAME-README.md"
[ -f "$SRC/domains/$NAME/README.md" ] || "$SDK_PY" "$HERE/extensions/lib/take_readme.py" \
  "$SRC" "$NAME" "$DIR/records/formalize-calls.jsonl" "$(basename "$DIR")" > "$README"
[ -f "$SRC/domains/$NAME/README.md" ] && readme=() || readme=(--readme "$README")

dry="$(sdk take "$NAME" --from "$SRC" "${readme[@]}" --dry-run --json)" || { echo "take.sh: $(printf '%s' "$dry" | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin).get("error"))')" >&2; exit 1; }
printf '%s' "$dry" | "$SDK_PY" -c 'import json,sys; o=json.load(sys.stdin); print(o["diff"], end="")'
echo
printf '%s' "$dry" | "$SDK_PY" -c 'import json,sys; [print("  " + f["path"] + (" (new)" if f["new"] else "")) for f in json.load(sys.stdin)["files"]]'
read -r -p "Take $NAME into $CAT? [y/N] " ok
[ "$ok" = y ] || [ "$ok" = Y ] || { echo "take.sh: nothing written."; exit 1; }
sdk take "$NAME" --from "$SRC" "${readme[@]}" --json > /dev/null
(cd "$CAT" && METIS_CATALOG="$CAT" "$SDK_PY" -m metis.kernel.artifact "$NAME")
echo "Taken, not committed: git -C $CAT status; commit domains/$NAME when you are satisfied (build/ and records/ are git-ignored)."
