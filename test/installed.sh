#!/usr/bin/env bash
# installed.sh [PI] — the pi package as a person installs it (pi-release s-8e13f6a8): the
# tarball `npm pack` makes, unpacked beside this checkout, installed into a scratch pi
# (PI_CODING_AGENT_DIR) with `pi install`, then: `pi list` shows it once, pi loads both
# extensions and both templates with no error (over --mode rpc, no model), and the
# extensions' test runs against the installed copy's extensions/ (TEST_PACKAGE_DIR; the
# package has no node_modules: the host's packages are the PI's, linked into the scratch
# copy for node's resolution only, as pi supplies them to the extensions it loads). The tarball's file list is test/pack-files.txt (rule 3). The python side is the
# person's: METIS_LOOP_SDK_PY (default python3) with metispy, metis-catalog and
# metis-loop-sdk installed. ci.yml's `installed` job runs it; so can a reviewer, by hand.
#
#   PI     the pi to install into (default: pi on PATH, e.g. npm i -g @earendil-works/pi-coding-agent@1.3.0)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PI="${1:-pi}"
PIBIN="$(command -v "$PI")"
PCA="$(dirname "$(readlink -f "$PIBIN")")"                          # …/@earendil-works/pi-coding-agent: up from its bin
until [ -f "$PCA/package.json" ] && grep -q '"name": *"@earendil-works/pi-coding-agent"' "$PCA/package.json"; do
  [ "$PCA" != / ] || { echo "installed.sh: $PIBIN is not @earendil-works/pi-coding-agent's" >&2; exit 1; }
  PCA="$(dirname "$PCA")"
done
W="$(mktemp -d)"                                                  # the scratch pi, the tarball, the unpacked package
PKG="$W/package"
trap 'rm -rf "$W"' EXIT
export PI_CODING_AGENT_DIR="$W/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0

echo "== the tarball (test/pack-files.txt)"
(cd "$HERE" && npm pack --pack-destination "$W" --ignore-scripts --json) > "$W/pack.json"
node -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[0]; console.log(p.files.map(f => f.path).sort().join("\n"))' "$W/pack.json" > "$W/files.txt"
diff "$HERE/test/pack-files.txt" "$W/files.txt"
tar -xzf "$W"/*.tgz -C "$W"
! grep -rIl -e /home/ -e "$(hostname)" "$PKG" || { echo "a path or the name of this host in the tarball" >&2; exit 1; }

echo "== pi install $PKG; pi list"
"$PI" install "$PKG"
"$PI" list | tee "$W/list.txt"
[ "$(grep -c -F "$PKG" "$W/list.txt")" -ge 1 ] && [ "$(grep -c '^  [^ ]' "$W/list.txt")" -eq 1 ] ||
  { echo "pi list: not one package" >&2; exit 1; }

echo "== pi loads the extensions and the templates (--mode rpc, no model)"
mkdir -p "$W/run"
(cd "$W/run" && node -e '
const pi = require("child_process").spawn(process.argv[1], ["--mode", "rpc", "--no-session"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const t = setTimeout(() => { console.error("no get_commands response in 60 s"); pi.kill(); process.exit(1); }, 60000);
pi.stdout.on("data", (d) => {
  buf += d;
  for (const l of buf.split("\n").slice(0, -1)) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.command !== "get_commands") continue;
    clearTimeout(t); pi.kill();
    const by = Object.fromEntries(r.data.commands.map((c) => [c.name, c.source]));
    for (const [n, s] of [["metis-loop", "prompt"], ["metis-seed", "prompt"], ["repl-served", "extension"]])
      if (by[n] !== s) { console.error(`${n}: ${by[n] ?? "missing"}, not a ${s}`); process.exit(1); }
    console.log("commands:", Object.keys(by).join(" ")); process.exit(0);
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
setTimeout(() => pi.stdin.write(JSON.stringify({ type: "get_commands" }) + "\n"), 3000);' "$(command -v "$PI")") 2> "$W/rpc.err"
cat "$W/rpc.err" >&2
! grep -i -E "error|failed to load" "$W/rpc.err" || { echo "pi reported an extension error" >&2; exit 1; }

echo "== the extensions' test against the installed copy"
mkdir -p "$PKG/node_modules/@earendil-works"
for m in @earendil-works/pi-ai @earendil-works/pi-coding-agent typebox; do        # pi's own copy: nested, or hoisted beside it
  for c in "$PCA/node_modules/$m" "$PCA/../../$m"; do [ -e "$c" ] && { ln -s "$(cd "$c" && pwd)" "$PKG/node_modules/$m"; break; }; done
done
(cd "$HERE" && TEST_PACKAGE_DIR="$PKG" node --experimental-strip-types --test test/extensions.test.ts)
echo "INSTALLED GREEN"
