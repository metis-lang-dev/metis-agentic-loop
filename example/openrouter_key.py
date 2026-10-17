#!/usr/bin/env python3
"""The OpenRouter key's spend, for the budget (openrouter-trial s-8676be8a):
GET https://openrouter.ai/api/v1/key with $OPENROUTER_API_KEY, printed as one
JSON object of numbers — limit, limit_remaining, usage (USD). The key itself
is never printed; an error names the HTTP status only. Stdlib only.

    OPENROUTER_API_KEY=… example/openrouter_key.py      (the key from the environment only)"""
import json
import os
import sys
import urllib.error
import urllib.request

key = os.environ.get("OPENROUTER_API_KEY", "")
if not key:
    sys.exit("OPENROUTER_API_KEY is not set")
req = urllib.request.Request("https://openrouter.ai/api/v1/key", headers={"authorization": "Bearer " + key})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.loads(r.read()).get("data") or {}
except urllib.error.HTTPError as e:
    sys.exit("the key endpoint answered HTTP %d" % e.code)
print(json.dumps({k: d.get(k) for k in ("limit", "limit_remaining", "usage", "usage_daily", "is_free_tier")}))
