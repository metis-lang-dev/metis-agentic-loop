"""A stand-in for the domain agent in the extensions' test: the ready line;
an intent -> accepted + ack; a tool -> a read + ack; a beat -> a surprise on
beat 2, then the clock line."""
import json, sys
print(json.dumps({"clock": "ready", "domain": "lamp", "beat": 0}), flush=True)
beat = 0
for line in sys.stdin:
    r = json.loads(line)
    if "clock" in r:
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
