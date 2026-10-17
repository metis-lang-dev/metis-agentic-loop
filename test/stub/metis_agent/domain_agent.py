"""A stand-in for the domain agent in the extensions' test: the ready line;
an intent -> accepted + ack; a tool -> a read + ack; a beat -> a surprise on
beat 2, then the clock line. STUB_SPIN=1: a program that never settles (the
domain agent's BEAT_STEPS) — every beat 100 x persist_lit and persist_dark
in turn, the unsettled quiescence, and the clock stays at 0."""
import json, os, sys
print(json.dumps({"clock": "ready", "domain": "lamp", "beat": 0}), flush=True)
beat = 0
spin = os.environ.get("STUB_SPIN") == "1"
seq = 0
for line in sys.stdin:
    r = json.loads(line)
    if "clock" in r and spin:
        for i in range(200):
            seq += 1
            rule = ("persist_lit", "persist_dark")[i % 2]
            print(json.dumps({"domain": "lamp", "kind": "event", "ref": {"seq": seq, "beat": 0, "event": rule},
                              "text": "The lamp stays %s." % rule[8:], "counts": {}, "voice": "line"}), flush=True)
        print(json.dumps({"domain": "lamp", "kind": "quiescence", "ref": {"seq": seq, "beat": 0}, "voice": "template",
                          "text": "the lamp did not settle: 200 steps in one beat, and persist_dark (100), persist_lit (100) "
                                  "kept firing; the beat stopped there", "goal_pending": False,
                          "unsettled": [["persist_dark", 100], ["persist_lit", 100]]}), flush=True)
        print(json.dumps({"clock": "beat", "beat": 0, "over": False}), flush=True)
    elif "clock" in r:
        beat += 1
        if beat == 2:
            print(json.dumps({"domain": "lamp", "kind": "surprise", "record": 0, "difference": {"lit": -1, "dark": 1}, "cards": []}), flush=True)
        print(json.dumps({"clock": "beat", "beat": beat, "over": False}), flush=True)
    elif "tool" in r:
        print(json.dumps({"domain": "lamp", "kind": "read", "tool": r["tool"], "output": "stage main\n  lit"}), flush=True)
        print(json.dumps({"ack": "tool", "id": r.get("id")}), flush=True)
    else:
        print(json.dumps({"domain": "lamp", "kind": "result", "id": r.get("id"), "status": "accepted", "text": "Accepted."}), flush=True)
        print(json.dumps({"ack": "intent", "id": r.get("id")}), flush=True)
