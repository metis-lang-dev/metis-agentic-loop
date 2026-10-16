#!/usr/bin/env python3
"""The worked example's person (docs/LOOP-AGENT.md "The worked example"): a pi
RPC client that plays the person of the agentic loop, so the run is repeatable.
It starts the loop (tools/pi/loop.sh --mode rpc) on a scratch catalog, gives
the goal and the prose, steers once, answers every apply confirmation, says
"continue" when the model stops before the loop is through (each one counted,
the person's turn), and stops the run (abort) at the end or at the budget.

    tools/pi/example/person.py DIR [--model ollama/metis-gemma4-e4b] [--minutes 60]
        [--deny-first]       refuse the first apply (the gate holds: the model must ask)

DIR gets the scratch catalog, the pi session, and:
    events.jsonl    every RPC record, as it came
    transcript.md   the run as read: the person, the model's words, every tool
                    call with its arguments and result (capped), the gates
    stages.json     per stage: first/last tool call, turns, seconds
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PI = HERE.parent

STAGE_OF = [  # the loop's stages by the tool the model calls (LOOP-AGENT.md)
    ("formalize", ("repl_text", "repl_formalize", "repl_revise")),
    ("apply", ("catalog_apply:program",)),
    ("intents", ("catalog_apply:intents",)),
    ("exercise", ("domain_open#1", "intent_", "domain_clock", "domain_state", "domain_why", "domain_events", "domain_ctx", "domain_findings")),
    ("revise", ("repl_mine", "repl_gate", "catalog_apply:extension", "repl_record", "repl_records", "repl_replay")),
    ("re-exercise", ("domain_open#2",)),
]

GOAL = ("Goal: formalize a new domain, `lamp`, from my description below; apply it to the catalog; "
        "draft its intents; then exercise it — switch it on and let time pass (a dozen beats) — and if the lamp "
        "surprises you, explain it with an extension, apply that, and exercise again.\n\nThe lamp:\n")
STEER = ("(the person) When you exercise the lamp, switch it on first and then advance the clock "
         "at least 8 beats before you read it.")
NUDGE = "(the person) Continue with the next step of the loop."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--model", default="ollama/metis-gemma4-e4b")
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--nudges", type=int, default=8)
    ap.add_argument("--deny-first", action="store_true")
    a = ap.parse_args()
    d = a.dir.resolve()
    d.mkdir(parents=True, exist_ok=True)
    prose = (HERE / "lamp" / "prose.md").read_text()
    env = dict(os.environ, MODEL=a.model)
    proc = subprocess.Popen([str(PI / "loop.sh"), "--scratch", str(d), "--mode", "rpc"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=open(d / "pi.stderr", "w"), env=env)
    ev = open(d / "events.jsonl", "w")
    tr = open(d / "transcript.md", "w")
    t0 = time.monotonic()
    stages, opens, turns, n_steer, nudges, denied = {}, 0, 0, 0, 0, 0
    calls = {}
    done_reason = None

    def say(s):
        tr.write(s + "\n")
        tr.flush()

    def send(rec):
        proc.stdin.write((json.dumps(rec) + "\n").encode())
        proc.stdin.flush()
        ev.write(json.dumps({"sent": rec}) + "\n")

    def stage_of(tool, args):
        key = tool
        if tool == "catalog_apply":
            key = f"catalog_apply:{args.get('what')}"
        if tool == "domain_open":
            key = f"domain_open#{min(opens, 2)}"
        for st, keys in STAGE_OF:
            if any(key == k or (k.endswith("_") and key.startswith(k)) for k in keys):
                return st
        return None

    say(f"# The agentic loop's worked example\n\nmodel {a.model}; started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    say(f"## the person\n\n{GOAL}{prose}")
    send({"id": "p1", "type": "prompt", "message": GOAL + prose})
    stream = proc.stdout
    while True:
        if time.monotonic() - t0 > a.minutes * 60:
            done_reason = "budget"
            break
        raw = stream.readline()
        if not raw:
            done_reason = "pi exited"
            break
        rec = json.loads(raw)
        ev.write(json.dumps(rec) + "\n")
        ev.flush()
        t = rec.get("type")
        el = time.monotonic() - t0
        if t == "turn_start":
            turns += 1
        elif t == "message_end" and rec["message"].get("role") == "assistant":
            for c in rec["message"].get("content", []):
                if c.get("type") == "text" and c["text"].strip():
                    say(f"**model** ({el:.0f} s): {c['text'].strip()}\n")
            u = rec["message"].get("usage") or {}
            if rec["message"].get("stopReason") == "error" or rec["message"].get("errorMessage"):
                say(f"_model error: {rec['message'].get('errorMessage')}_\n")
        elif t == "tool_execution_start":
            args = rec.get("args") or {}
            name = rec.get("toolName")
            if name == "domain_open":
                opens += 1
            st = stage_of(name, args)
            calls[rec.get("toolCallId")] = (name, args, st, el)
            if st:
                s = stages.setdefault(st, {"first": el, "last": el, "calls": 0, "turn_first": turns})
                s["last"], s["calls"] = el, s["calls"] + 1
                s["turn_last"] = turns
            say(f"→ `{name}` {json.dumps(args)}  _[{st or '-'}; {el:.0f} s]_")
        elif t == "tool_execution_end":
            r = rec.get("result") or {}
            txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
            flag = "ERROR " if rec.get("isError") else ""
            say(f"  ← {flag}{txt[:1200]}\n")
            name = calls.get(rec.get("toolCallId"), ("",))[0]
            if name == "domain_open" and opens >= 2 and not rec.get("isError"):
                pass
        elif t == "extension_ui_request":
            m = rec.get("method")
            if m in ("confirm", "select"):
                title = rec.get("title", "")
                ok = not (a.deny_first and denied == 0)
                if not ok:
                    denied += 1
                say(f"**gate** ({el:.0f} s): {title}\n\n```\n{rec.get('message', '')[:1500]}\n```\n**the person {'approves' if ok else 'refuses'}**\n")
                resp = {"type": "extension_ui_response", "id": rec["id"]}
                resp.update({"confirmed": ok} if m == "confirm" else ({"value": "Yes"} if ok else {"cancelled": True}))
                send(resp)
                if ok and "extensions" in title and n_steer >= 1:
                    pass
            elif m == "notify":
                say(f"_pi notice: {rec.get('message', '')}_\n")
        elif t == "message_end" and rec["message"].get("role") == "custom":
            say(f"**signal** ({el:.0f} s): {str(rec['message'].get('content'))[:800]}\n")
        elif t == "agent_settled":
            if "re-exercise" in stages and stages["re-exercise"]["calls"] and any(
                    k == "re-exercise" for k in stages) and stages.get("re-exercise", {}).get("last", 0) and \
                    time.monotonic() - t0 - stages["re-exercise"]["last"] > 0 and _explained(d):
                done_reason = "loop through: the re-exercise ran"
                break
            if nudges >= a.nudges:
                done_reason = f"the model stopped ({nudges} nudges used)"
                break
            nudges += 1
            say(f"## the person ({el:.0f} s)\n\n{NUDGE}\n")
            send({"type": "prompt", "message": NUDGE})
        # the one steer, mid-run: when the program is applied (before the exercise)
        if n_steer == 0 and "apply" in stages:
            n_steer += 1
            say(f"## the person steers ({el:.0f} s)\n\n{STEER}\n")
            send({"type": "steer", "message": STEER})
    send({"type": "abort"})
    time.sleep(2)
    proc.stdin.close()
    try:
        proc.wait(20)
    except subprocess.TimeoutExpired:
        proc.kill()
    total = time.monotonic() - t0
    out = {"model": a.model, "reason": done_reason, "seconds": round(total), "turns": turns, "nudges": nudges,
           "denied": denied, "stages": stages, "explained_after": _explained(d)}
    (d / "stages.json").write_text(json.dumps(out, indent=1))
    say(f"\n## end: {done_reason} — {total:.0f} s, {turns} turns, {nudges} nudges\n")
    print(json.dumps(out, indent=1))


def _explained(d: Path) -> bool:
    """The re-exercise's proof: a records line closed `explained` (the domain
    agent's sink), or none surprised after the extension was applied."""
    for f in (d / "records").glob("*.jsonl"):
        for line in f.read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if (r.get("close") or {}).get("status") == "explained":
                return True
    return False


if __name__ == "__main__":
    sys.exit(main())
