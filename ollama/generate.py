#!/usr/bin/env python3
"""The kernel's formalize on Ollama with thinking off (agentic-loop s-3ddb3e87):
metispy's `command:ARGV` LLM backend (prompt on stdin, completion on stdout,
metis.loop.llm). metispy's own ollama backend posts /api/generate without
`think`, and Gemma 4 then thinks for minutes per draft; this adapter asks for
the answer only, at temperature 0 (formalize's), capped. Stdlib only.

    [llm]
    endpoint = "command:python3 tools/pi/ollama/generate.py --model metis-gemma4-e4b --url http://127.0.0.1:11434"
"""
import argparse
import json
import sys
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--url", default="http://127.0.0.1:11434")
ap.add_argument("--num-predict", type=int, default=2048)
ap.add_argument("--timeout", type=int, default=600)
a = ap.parse_args()
body = {"model": a.model, "prompt": sys.stdin.read(), "stream": False, "think": False,
        "options": {"temperature": 0, "num_predict": a.num_predict}}
req = urllib.request.Request(a.url.rstrip("/") + "/api/generate", data=json.dumps(body).encode(),
                             headers={"content-type": "application/json"})
with urllib.request.urlopen(req, timeout=a.timeout) as r:
    sys.stdout.write(json.loads(r.read())["response"])
