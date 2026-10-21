#!/usr/bin/env python3
"""A seeded run's person over pi RPC, with a human at every gate, through files: for a
person (or an agent) who is not at the TUI (opus's, from fiction-port s-e3d0942d step 2;
example/ in loop-fixes s-855d8067). example/person.py plays a whole formalize run by
itself; this one stops at every gate and waits for the answer.

    example/seedperson.py DIR --seed PATH.llp [--name NAME] [--model M] [--max-usd 0.3] [--minutes 40]

Starts cd DIR && loop.sh --seed … --mode rpc under a MemoryMax=6G scope (DIR is the
catalog the seed becomes a domain of; cwd-root s-ddac2cbf), sends DIR/.metis/seed/task.md as
the first message, and logs everything (events.jsonl, transcript.md) in DIR/.metis/ (the
loop's state; every file named below is there). At each gate (extension_ui_request
confirm/select) and each time the agent settles, it writes the question to ask/<n>.md,
puts that path in WAITING, and waits for ask/<n>.ans:
  gate:    first line y | n ; any further lines are sent as a steer after the answer
  settled: 'stop', or the text of the next prompt
pi's own cost (its usage.cost) over --max-usd aborts the run. At the end run.json
holds the reason, the seconds, pi's cost, the requests and every gate's answer; DONE
appears. With OPENROUTER_API_KEY set, run.json also has the key's usage before and after
(example/openrouter_key.py) and their difference, usd_by_key.
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

LOOP = Path(__file__).resolve().parents[1]           # metis-agentic-loop


def key_usage():
    """The OpenRouter key's usage in USD (example/openrouter_key.py), or None without a key."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        return None
    r = subprocess.run([sys.executable, str(LOOP / "example" / "openrouter_key.py")], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)["usage"]
    except (ValueError, KeyError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path)
    ap.add_argument("--seed", required=True)
    ap.add_argument("--name")
    ap.add_argument("--model", default="openrouter/deepseek/deepseek-v4-pro:off")
    ap.add_argument("--max-usd", type=float, default=0.3)
    ap.add_argument("--minutes", type=float, default=40)
    a = ap.parse_args()
    cat = a.dir.resolve()
    d = cat / ".metis"                                  # the loop's state (loop.sh: the SDK's catalog.state())
    d.mkdir(parents=True, exist_ok=True)
    ask = d / "ask"
    ask.mkdir(exist_ok=True)
    env = dict(os.environ, MODEL=a.model, METIS_LOOP_CUDA="")
    env.pop("METIS_CATALOG", None)                      # the catalog is the cwd, DIR
    # an RDDL world's gym runs under the packages' shared venv (loop.sh's default too; rddl-worlds step 2)
    env.setdefault("METIS_RDDL_PY", str(LOOP.parent / ".venv" / "bin" / "python"))
    cmd = ["systemd-run", "--user", "--scope", "-q", "-p", "MemoryMax=6G", "-p", "MemorySwapMax=0",
           str(LOOP / "loop.sh"), "--seed", a.seed] + (["--name", a.name] if a.name else []) + \
          ["--mode", "rpc"]
    before = key_usage()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(d / "pi.stderr", "w"), env=env,
                            cwd=cat)
    # the time limit holds while readline waits on a silent pi: the watchdog ends it
    watchdog = threading.Timer(a.minutes * 60, proc.kill)
    watchdog.daemon = True
    watchdog.start()
    ev = open(d / "events.jsonl", "w")
    tr = open(d / "transcript.md", "w")
    t0 = time.monotonic()
    usd, reqs, n = 0.0, 0, 0
    calls, gates, last_text = {}, [], ""
    reason = None

    def say(s):
        tr.write(s + "\n")
        tr.flush()

    def send(rec):
        try:
            proc.stdin.write((json.dumps(rec) + "\n").encode())
            proc.stdin.flush()
        except (BrokenPipeError, OSError):          # pi has exited: the run's end is still written
            return False
        ev.write(json.dumps({"sent": rec}) + "\n")
        ev.flush()
        return True

    def question(kind, text):
        nonlocal n
        n += 1
        q = ask / f"{n:02d}-{kind}.md"
        q.write_text(text)
        (d / "WAITING").write_text(str(q) + "\n")
        ans = q.with_suffix(".ans")
        while not ans.exists():
            if time.monotonic() - t0 > a.minutes * 60:
                (d / "WAITING").unlink(missing_ok=True)
                return None
            time.sleep(1)
        time.sleep(0.3)
        (d / "WAITING").unlink(missing_ok=True)
        return ans.read_text()

    task_f = d / "seed" / "task.md"
    for _ in range(120):
        if task_f.exists() or proc.poll() is not None:
            break
        time.sleep(0.5)
    if not task_f.exists():                          # loop.sh refused the seed, or never got there
        proc.kill()
        out = {"seed": a.seed, "reason": "no seed/task.md (see pi.stderr)", "rc": proc.wait()}
        (d / "run.json").write_text(json.dumps(out, indent=1))
        (d / "DONE").write_text(json.dumps(out) + "\n")
        print(json.dumps(out))
        return 1
    task = task_f.read_text()
    say(f"# seeded run: {a.seed} on {a.model}\n\nstarted {time.strftime('%F %T')}\n\n## the person (the task)\n\n{task}")
    send({"id": "p1", "type": "prompt", "message": task})

    while True:
        if time.monotonic() - t0 > a.minutes * 60:
            reason = "time budget"
            break
        raw = proc.stdout.readline()
        if not raw:
            reason = "time budget" if time.monotonic() - t0 > a.minutes * 60 else "pi exited"
            break
        try:
            rec = json.loads(raw)
        except ValueError:
            say(f"_non-JSON: {raw[:300]!r}_")
            continue
        ev.write(json.dumps(rec) + "\n")
        ev.flush()
        t = rec.get("type")
        el = time.monotonic() - t0
        if t == "message_end" and rec["message"].get("role") == "assistant":
            u = rec["message"].get("usage") or {}
            usd += (u.get("cost") or {}).get("total") or 0
            reqs += 1
            for c in rec["message"].get("content", []):
                if c.get("type") == "text" and c["text"].strip():
                    last_text = c["text"].strip()
                    say(f"**model** ({el:.0f} s): {last_text}\n")
            if rec["message"].get("errorMessage"):
                say(f"_model error: {rec['message'].get('errorMessage')}_\n")
            if usd > a.max_usd:
                reason = f"pi's cost passed {a.max_usd} USD"
                break
        elif t == "tool_execution_start":
            calls[rec.get("toolCallId")] = rec.get("toolName")
            say(f"→ `{rec.get('toolName')}` {json.dumps(rec.get('args') or {})[:1500]}  _[{el:.0f} s]_")
        elif t == "tool_execution_end":
            r = rec.get("result") or {}
            txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
            say(f"  ← {'ERROR ' if rec.get('isError') else ''}{txt[:2000]}\n")
        elif t == "extension_ui_request":
            m = rec.get("method")
            if m in ("confirm", "select"):
                title, body = rec.get("title", ""), rec.get("message", "")
                ans = question("gate", f"# {title}\n\n```diff\n{body}\n```\n")
                if ans is None:
                    reason = "no answer at a gate"
                    break
                lines = ans.strip().split("\n", 1)
                ok = lines[0].strip().lower().startswith("y")
                gates.append({"title": title, "approved": ok, "s": round(el)})
                say(f"**gate** ({el:.0f} s): {title}\n\n```diff\n{body}\n```\n**the person {'approves' if ok else 'refuses'}**\n")
                resp = {"type": "extension_ui_response", "id": rec["id"]}
                resp.update({"confirmed": ok} if m == "confirm" else ({"value": "Yes"} if ok else {"cancelled": True}))
                send(resp)
                if len(lines) > 1 and lines[1].strip():
                    say(f"## the person steers ({el:.0f} s)\n\n{lines[1].strip()}\n")
                    send({"type": "steer", "message": lines[1].strip()})
            elif m == "notify":
                say(f"_pi notice: {rec.get('message', '')}_\n")
        elif t == "agent_settled":
            ans = question("settled", f"# the agent settled ({el:.0f} s, pi cost {usd:.4f} USD)\n\nlast words:\n\n{last_text}\n")
            if ans is None or ans.strip().lower() == "stop":
                reason = "the person stopped" if ans else "no answer when settled"
                break
            say(f"## the person ({el:.0f} s)\n\n{ans.strip()}\n")
            send({"type": "prompt", "message": ans.strip()})
    watchdog.cancel()
    send({"type": "abort"})
    time.sleep(2)
    try:
        proc.stdin.close()
        proc.wait(20)
    except Exception:
        proc.kill()
    out = {"seed": a.seed, "model": a.model, "reason": reason, "seconds": round(time.monotonic() - t0),
           "pi_usd": round(usd, 5), "requests": reqs, "gates": gates}
    if before is not None:
        time.sleep(15)                               # the key's usage lags the last request a little
        after = key_usage()
        out.update(key_usage_before=before, key_usage_after=after,
                   usd_by_key=round(after - before, 6) if after is not None else None)
    (d / "run.json").write_text(json.dumps(out, indent=1))
    say(f"\n## end: {reason}\n")
    (d / "DONE").write_text(json.dumps(out) + "\n")
    print(json.dumps(out))


if __name__ == "__main__":
    sys.exit(main())
