#!/usr/bin/env bash
# take.sh — a demo run's domain into the catalog, laid out as the dog is (agentic-loop
# s-3ddb3e87 step 3). The run's catalog is a scratch one (tools/, the plant beside the
# lamp); this takes the one domain over through the loop SDK's catalog CLI (`take`: its
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

# the README: the run's own, else one written from what the run left
README="$DIR/$NAME-README.md"
[ -f "$SRC/domains/$NAME/README.md" ] || "$SDK_PY" - "$DIR" "$NAME" > "$README" <<'PY'
import json, re, sys
from pathlib import Path
run, name = Path(sys.argv[1]), sys.argv[2]
d = run / "catalog" / "domains" / name
prog = (d / f"{name}.llp").read_text()
m = re.search(r'provenance text "((?:[^"\\]|\\.)*)"', prog)
prose = m.group(1) if m else ""
calls = run / "records" / "formalize-calls.jsonl"
rows = [json.loads(l) for l in calls.read_text().splitlines() if l.strip()] if calls.is_file() else []
model = rows[0]["model"] if rows else "?"
cost = sum(r.get("cost") or 0 for r in rows)
first = (prose.split(". ")[0].rstrip(".") or f"the {name}")
print(f"# {name} — {first[0].lower() + first[1:]}\n")
print(f"**Where it came from:** the agentic loop's demo (metis-agentic-loop `demo.sh`), run "
      f"`{run.name}`: pi drove, and the kernel's formalize drafted the program on `{model}` "
      f"(formalize: {len(rows)} calls, {cost:.4f} USD; pi's own calls are on the key's usage). "
      f"Every file was approved at pi's apply gate; "
      f"`take.sh` brought it here.\n")
print(f"**What:** `{name}.llp` formalizes the person's prose (its provenance line). "
      f"`{name}_host.py` is the world, written before any program: the loop exercised the "
      f"program against it, and the extensions explain what the world did that the program did not say.\n")
ext = sorted((d / "extensions").glob("*.llp")) if (d / "extensions").is_dir() else []
if ext:
    print("## The extensions\n")
    for e in ext:
        rules = [l.strip() for l in e.read_text().splitlines() if re.match(r"\s*\w+\s*\[\w+\]\s*:", l)]
        print(f"- `extensions/{e.name}`: " + "; ".join(f"`{r}`" for r in rules))
    print()
print("## Exercise it\n")
print("- the loop console (metis-loop `run.sh`) and the agents serve the program with its extensions "
      "(domain.yaml: `extensions/*.llp` in name order); the console lists it at its next catalog read;")
print(f"- the program alone in the REPL: `metis --plugin {name}_host:make {name}.llp`;")
print(f"- its intents: `python3 tools/intents.py check {name}` (intent.yaml is the skeleton the loop drafted: "
      f"write the meanings and more examples, then `gen`).")
PY
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
