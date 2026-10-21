#!/usr/bin/env bash
# world.sh DIR — the lamp's world laid out in the catalog DIR (cwd-root s-ddac2cbf): what a
# demo starts the loop in. The lamp is prose and a host, not a package to --seed: DIR gets
# a known domain beside it (the plant, from the installed metis-catalog: formalize shows
# the model a served world's vocabulary, and E4B writes no LLP over a blank one), the
# lamp's host before any program (DIR/domains/lamp/lamp_host.py), and its .metis/ (the
# loop SDK's state). Prints the program the REPL starts on (METIS_LOOP_LLP: the plant's).
# demo.sh, example/person.py and example/scripted.ts run it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK_PY="${METIS_LOOP_SDK_PY:-$HERE/../../../.venv/bin/python}"
DIR="$(mkdir -p "${1:?usage: world.sh DIR}" && cd "$1" && pwd)"
INST="$("$SDK_PY" -m metis_loop_sdk.catalog installed --json | "$SDK_PY" -c 'import json,sys; print(json.load(sys.stdin)["catalog"])')"
if [ ! -d "$DIR/domains/plant" ]; then
  mkdir -p "$DIR/domains/plant"
  (cd "$INST/domains/plant" && tar --exclude=./build --exclude=./records --exclude=__pycache__ -cf - .) | (cd "$DIR/domains/plant" && tar -xf -)
fi
mkdir -p "$DIR/domains/lamp" && cp "$HERE/lamp_host.py" "$DIR/domains/lamp/"
"$SDK_PY" -m metis_loop_sdk.catalog --root "$DIR" state --json > /dev/null
echo "$DIR/domains/plant/plant.llp"
