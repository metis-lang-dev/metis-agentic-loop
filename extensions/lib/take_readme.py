"""take_readme — a README for a domain the agentic loop made, written from
what the run left (catalog_take and take.sh: the domain has none of its own).

    python take_readme.py SRC_CATALOG NAME [FORMALIZE_CALLS_JSONL [RUN_LABEL]]

SRC_CATALOG the run's (scratch) catalog root; the calls file is the run's
records/formalize-calls.jsonl (the loop SDK's openai-command --log). The
README goes to stdout."""
import json
import re
import sys
from pathlib import Path

src, name = Path(sys.argv[1]), sys.argv[2]
calls = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
label = sys.argv[4] if len(sys.argv) > 4 else src.resolve().parent.name
d = src / "domains" / name
prog = (d / f"{name}.llp").read_text()
m = re.search(r'provenance text "((?:[^"\\]|\\.)*)"', prog)
prose = m.group(1) if m else ""
rows = [json.loads(l) for l in calls.read_text().splitlines() if l.strip()] if calls and calls.is_file() else []
first = prose.split(". ")[0].rstrip(".") or f"the {name}"
print(f"# {name} — {first[0].lower() + first[1:]}\n")
how = (f"the kernel's formalize drafted the program on `{rows[0]['model']}` (formalize: {len(rows)} calls, "
       f"{sum(r.get('cost') or 0 for r in rows):.4f} USD; pi's own calls are on the key's usage)"
       if rows else "the kernel's formalize drafted the program")
print(f"**Where it came from:** the agentic loop (metis-agentic-loop), run `{label}`: pi drove, and {how}. "
      f"Every file was approved at pi's apply gate, and taken into this catalog from the run's.\n")
print(f"**What:** `{name}.llp` formalizes the person's prose (its provenance line)."
      + (f" `{name}_host.py` is the world, written before any program: the loop exercised the program against it,"
         " and the extensions explain what the world did that the program did not say."
         if (d / f"{name}_host.py").is_file() else "") + "\n")
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
if (d / f"{name}_host.py").is_file():
    print(f"- the program alone in the REPL: `metis --plugin {name}_host:make {name}.llp`;")
if (d / "intent.yaml").is_file():
    print(f"- its intents: `python3 tools/intents.py check {name}` (intent.yaml is the skeleton the loop drafted: "
          f"write the meanings and more examples, then `gen`).")
