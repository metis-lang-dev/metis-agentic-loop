#!/usr/bin/env python3
"""The worked example's person (docs/LOOP-AGENT.md "The worked example"): a pi
RPC client that plays the person of the agentic loop, so the run is repeatable.
It lays out the lamp's world in DIR (example/lamp/world.sh), starts the loop there
(cd DIR && loop.sh --mode rpc: DIR is the catalog; cwd-root s-ddac2cbf), gives
the goal and the prose, steers once, answers every apply confirmation, says
"continue" when the model stops before the loop is through (each one counted,
the person's turn), and stops the run (abort) at the end or at the budget.

    example/person.py DIR [--model ollama/metis-gemma4-e4b] [--minutes 60]
        [--deny-first]       refuse the first apply (the gate holds: the model must ask)
        [--max-usd X]        abort once the model's cost (pi's usage, the catalog's prices) passes X

DIR is the catalog the run writes (domains/lamp/); DIR/.metis/ gets the pi session, the
records, and:
    events.jsonl    every RPC record, as it came
    transcript.md   the run as read: the person, the model's words, every tool
                    call with its arguments and result (capped), the gates
    stages.json     per stage: first/last tool call, turns, seconds; the model's
                    tokens and cost; the failure classes counted (fake calls in
                    its text, calls to tools that do not exist, the wrong layer)
"""
import argparse
import json
import os
import re
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
STEER_FORMALIZE = (
    "(the person) Let me give you the rules exactly; put this as the text (repl_text) and draft again (repl_formalize, empty arg), "
    "then repl_revise: catalog lamp 1, one stage main. Declare each atom on its own line: pred lit : lamp. pred dark : lamp. "
    "pred cmd_on : lamp. pred cmd_off : lamp. pred done(on) : lamp. pred done(off) : lamp. pred worn : lamp. "
    "Rules: switch_on [dyn] : dark * cmd_on -o lit * done(on). switch_off [dyn] : lit * cmd_off -o dark * done(off). "
    "on_again [dyn] : cmd_on * $lit -o done(on). off_again [dyn] : cmd_off * $dark -o done(off). "
    "Each rule has a %% line saying it in words. After the stage, the start state without a dot: #init dark 1")
STEER_INTENT = ("(the person) Switch the lamp on in the domain with intent_on, then advance its clock "
                "8 beats with domain_clock, and read what it says.")
STEER_EXERCISE = ("(the person) When you exercise the lamp, switch it on first and then advance the clock "
                  "at least 8 beats before you read it.")
NUDGE = "(the person) Continue with the next step of the loop."
# a call written into the text instead of made: Gemma's markers, a JSON call, response: blocks
FAKE_CALL = re.compile(r"(?:response|call):\w+\{|<\|tool_response>|\{\s*\"name\"\s*:\s*\"\w+\"\s*,\s*\"(?:arguments|parameters)\"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--model", default="ollama/metis-gemma4-e4b")
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--nudges", type=int, default=8)
    ap.add_argument("--deny-first", action="store_true")
    ap.add_argument("--max-usd", type=float, default=0)
    a = ap.parse_args()
    cat = a.dir.resolve()
    llp = subprocess.run([str(HERE / "lamp" / "world.sh"), str(cat)], check=True, capture_output=True, text=True).stdout.strip()
    d = cat / ".metis"                                  # the loop's state: the run's files beside its records
    prose = (HERE / "lamp" / "prose.md").read_text()
    env = dict(os.environ, MODEL=a.model, METIS_LOOP_LLP=llp)
    env.pop("METIS_CATALOG", None)
    proc = subprocess.Popen([str(PI / "loop.sh"), "--mode", "rpc"], stdin=subprocess.PIPE, cwd=cat,
                            stdout=subprocess.PIPE, stderr=open(d / "pi.stderr", "w"), env=env)
    ev = open(d / "events.jsonl", "w")
    tr = open(d / "transcript.md", "w")
    t0 = time.monotonic()
    stages, opens, turns, n_steer, nudges, denied = {}, 0, 0, 0, 0, 0
    calls = {}
    steer2, used_intent = None, False
    done_reason = None
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "usd": 0.0, "requests": 0, "length_stops": 0}
    dead = 0
    fails = {"fake_calls_in_text": 0, "fake_call_messages": 0, "unknown_tools": 0, "wrong_layer": 0}

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
        if tool == "domain_open":         # a re-exercise is an open after an extension was applied
            key = "domain_open#2" if "revise" in stages and stages["revise"].get("applied") else "domain_open#1"
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
            u = rec["message"].get("usage") or {}
            for k in ("input", "output", "cacheRead", "cacheWrite"):
                usage[k] += u.get(k) or 0
            usage["usd"] += (u.get("cost") or {}).get("total") or 0
            usage["requests"] += 1
            usage["length_stops"] += rec["message"].get("stopReason") == "length"
            for c in rec["message"].get("content", []):
                if c.get("type") == "text" and c["text"].strip():
                    k = len(FAKE_CALL.findall(c["text"]))
                    fails["fake_calls_in_text"] += k
                    fails["fake_call_messages"] += k > 0
                    say(f"**model** ({el:.0f} s): {c['text'].strip()}\n")
            if a.max_usd and usage["usd"] > a.max_usd:
                done_reason = f"the cost passed {a.max_usd} USD"
                break
            if rec["message"].get("stopReason") == "error" or rec["message"].get("errorMessage"):
                say(f"_model error: {rec['message'].get('errorMessage')}_\n")
        elif t == "tool_execution_start":
            args = rec.get("args") or {}
            name = rec.get("toolName")
            calls[rec.get("toolCallId")] = (name, args, None, el)
            used_intent = used_intent or (name or "").startswith("intent_")
            say(f"→ `{name}` {json.dumps(args)}  _[{el:.0f} s]_")
        elif t == "tool_execution_end":
            name, args = calls.get(rec.get("toolCallId"), ("", {}, None, el))[:2]
            if not rec.get("isError") and "refused:" not in json.dumps(rec.get("result") or {})[:200]:
                if name == "domain_open":          # a stage counts only what went through
                    opens += 1
                st = stage_of(name, args)
                if name == "catalog_apply" and (args or {}).get("what") == "extension":
                    stages.setdefault("revise", {"first": el, "last": el, "calls": 0, "turn_first": turns})["applied"] = True
                if st:
                    s = stages.setdefault(st, {"first": el, "last": el, "calls": 0, "turn_first": turns})
                    s["last"], s["calls"] = el, s["calls"] + 1
                    s["turn_last"] = turns
                    say(f"  _[stage {st}]_")
            r = rec.get("result") or {}
            txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
            if rec.get("isError") and re.search(r"(?i)tool .*not found|unknown tool|not found", txt):
                fails["unknown_tools"] += 1
            dead = dead + 1 if rec.get("isError") and "has exited" in txt else 0
            if dead >= 8:          # every call answers from a dead process: stop paying for the run
                done_reason = "a tool's process is dead (8 calls in a row)"
                break
            if name == "repl_do" and re.match(r"\s*cmd_", str((args or {}).get("arg", ""))):
                fails["wrong_layer"] += 1           # a command atom said in the REPL, not an intent to the domain
            flag = "ERROR " if rec.get("isError") else ""
            say(f"  ← {flag}{txt[:1200]}\n")
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
            elif m == "notify":
                say(f"_pi notice: {rec.get('message', '')}_\n")
        elif t == "message_end" and rec["message"].get("role") == "custom":
            say(f"**signal** ({el:.0f} s): {str(rec['message'].get('content'))[:800]}\n")
        elif t == "agent_settled":
            if "re-exercise" in stages:                 # the loop went through to the second open
                done_reason = "the loop is through: settled after the re-exercise"
                break
            if nudges >= a.nudges:
                done_reason = f"the model stopped ({nudges} nudges used)"
                break
            nudges += 1
            say(f"## the person ({el:.0f} s)\n\n{NUDGE}\n")
            send({"type": "prompt", "message": NUDGE})
        # the one steer, mid-run: at the first failed draft (the person knows the
        # language), else once the program is applied (how to exercise it)
        if n_steer == 0 and t == "tool_execution_end":
            name, args = calls.get(rec.get("toolCallId"), ("", {}))[:2]
            txt = json.dumps(rec.get("result") or {})
            msg = None
            if name in ("repl_formalize", "repl_revise") and ('\\"ok\\": false' in txt or "refused" in txt):
                msg = STEER_FORMALIZE
            elif name == "catalog_apply" and not rec.get("isError") and (args or {}).get("what") == "program":
                msg = STEER_EXERCISE
            if msg:
                n_steer += 1
                say(f"## the person steers ({el:.0f} s)\n\n{msg}\n")
                send({"type": "steer", "message": msg})
        # a second steer: the domain is open but the model says no intent to it
        if n_steer == 1 and steer2 is None and "exercise" in stages and not used_intent and \
                turns - stages["exercise"]["turn_first"] >= 2:
            steer2 = el
            n_steer += 1
            say(f"## the person steers ({el:.0f} s)\n\n{STEER_INTENT}\n")
            send({"type": "steer", "message": STEER_INTENT})
    send({"type": "abort"})
    time.sleep(2)
    proc.stdin.close()
    try:
        proc.wait(20)
    except subprocess.TimeoutExpired:
        proc.kill()
    total = time.monotonic() - t0
    out = {"model": a.model, "reason": done_reason, "seconds": round(total), "turns": turns, "nudges": nudges,
           "denied": denied, "steers": n_steer, "stages": stages, "explained_after": _explained(d),
           "usage": usage, "fails": fails}
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
