// The two extensions against stand-ins (no model, no pi session): the tools are
// generated from the interfaces' declarations, the apply gate holds (no person,
// a refusal, an ungated candidate) and writes only what the person approved,
// and a domain's surprise enters the loop as a steered message.
//   node/bin/node --experimental-strip-types --test test/extensions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import repl from "../extensions/metis-repl.ts";
import domain from "../extensions/metis-domain.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// the sibling checkouts (metis-agentic-loop beside metispy's venv and metis-agent);
// CI points these at its own installs
const PKGS = join(HERE, "..", "..");
const AGENT = join(PKGS, "metis-agent");

function fakePi() {
	const tools = new Map<string, any>();
	const on = new Map<string, ((e: any, c: any) => any)[]>();
	const messages: { msg: any; opts: any }[] = [];
	return {
		tools,
		messages,
		emit: async (ev: string, e: any, c: any) => {
			let r;
			for (const h of on.get(ev) ?? []) r = await h(e, c);
			return r;
		},
		api: {
			registerTool: (t: any) => tools.set(t.name, t),
			registerCommand: () => {},
			on: (ev: string, h: any) => on.set(ev, [...(on.get(ev) ?? []), h]),
			sendMessage: (msg: any, opts: any) => messages.push({ msg, opts }),
		} as any,
	};
}

function env(gated: boolean) {
	const cat = mkdtempSync(join(tmpdir(), "loop-cat-"));
	mkdirSync(join(cat, "domains", "lamp"), { recursive: true });
	writeFileSync(join(cat, "domains", "lamp", "lamp_host.py"), "# the world\n");
	Object.assign(process.env, {
		METIS_CATALOG: cat,
		METIS_LOOP_METIS: join(HERE, "stub", "metis"),
		REAL_METIS: process.env.REAL_METIS ?? join(PKGS, ".venv", "bin", "metis"),
		STUB_LOG: join(cat, "stub.log"),
		STUB_GATED: gated ? "1" : "0",
		METIS_LOOP_LLP: "",
	});
	return cat;
}

const ui = (answer: boolean) => ({ hasUI: true, ui: { confirm: async () => answer, notify: () => {} } });

test("metis-repl: the wire's verbs become tools, its words or the finding's marker", async () => {
	env(true);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	assert.deepEqual([...p.tools.keys()].sort(), ["catalog_apply", "repl_formalize", "repl_gate", "repl_show", "repl_state", "repl_text"]);
	assert.match(p.tools.get("repl_state").description, /the domain's current state/);
	assert.match(p.tools.get("repl_text").description, /finding: metispy/);
	const r = await p.tools.get("repl_text").execute("c1", { arg: "a desk lamp" });
	assert.equal(r.content[0].text, "text a desk lamp");
	await p.emit("session_shutdown", {}, {});
});

test("metis-repl: the apply gate — no person, a refusal, an ungated candidate block; an approval writes and reopens", async () => {
	const cat = env(true);
	const p = fakePi();
	repl(p.api);
	await p.emit("session_start", {}, ui(true));
	const call = (id: string) => ({ toolName: "catalog_apply", toolCallId: id, input: { domain: "lamp", what: "program" } });
	assert.match((await p.emit("tool_call", call("a"), { hasUI: false, ui: {} })).reason, /no person/);
	assert.match((await p.emit("tool_call", call("b"), ui(false))).reason, /did not approve/);
	await assert.rejects(p.tools.get("catalog_apply").execute("b", { domain: "lamp", what: "program" }), /not approved/);
	assert.ok(!existsSync(join(cat, "domains", "lamp", "lamp.llp")));
	assert.equal(await p.emit("tool_call", call("c"), ui(true)), undefined);
	const r = await p.tools.get("catalog_apply").execute("c", { domain: "lamp", what: "program" });
	assert.match(r.content[0].text, /applied: .*lamp\.llp.*domain\.yaml.*serves .*lamp\.llp with its host/);
	assert.match(readFileSync(join(cat, "domains", "lamp", "lamp.llp"), "utf8"), /^catalog lamp 1\./);
	assert.match(readFileSync(join(cat, "domains", "lamp", "domain.yaml"), "utf8"), /program: lamp\.llp\nhost: lamp_host\.py:make\n/);
	const argv = readFileSync(join(cat, "stub.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l).argv);
	assert.deepEqual(argv.at(-1).slice(0, 2), ["--json", "--host"]);   // reopened on the program, with its host
	await p.emit("session_shutdown", {}, {});
	env(false);
	const q = fakePi();
	repl(q.api);
	await q.emit("session_start", {}, ui(true));
	assert.match((await q.emit("tool_call", call("d"), ui(true))).reason, /not passed the gate/);
	await q.emit("session_shutdown", {}, {});
});

test("metis-domain: J from intent.yaml, T from tools.json, the clock; a surprise is steered in", async () => {
	const cat = env(true);
	const d = join(cat, "domains", "lamp");
	writeFileSync(join(d, "lamp.llp"), "catalog lamp 1.\n");
	writeFileSync(join(d, "domain.yaml"), "program: lamp.llp\nintent: {spec: intent.yaml}\n");
	writeFileSync(join(d, "intent.yaml"), "verbs:\n- verb: SWITCH_ON\n  meaning: The person switches the lamp on.\nslots: {}\n");
	Object.assign(process.env, {
		METIS_LOOP_AGENT_PY: process.env.TEST_AGENT_PY ?? join(AGENT, "py", ".venv", "bin", "python"),
		METIS_LOOP_AGENT_DIR: join(HERE, "stub"),
	});
	const p = fakePi();
	domain(p.api);
	const o = await p.tools.get("domain_open").execute("o", { domain: "lamp" });
	assert.match(o.content[0].text, /lamp is open at beat 0; 1 intent verb/);
	for (const t of ["intent_switch_on", "domain_state", "domain_why", "domain_explain", "domain_consult", "domain_clock"]) assert.ok(p.tools.has(t), t);
	assert.ok(!p.tools.has("domain_activate") && !p.tools.has("domain_keep"));      // the orchestrator's, not the domain agent's
	assert.match((await p.tools.get("intent_switch_on").execute("i", {})).content[0].text, /accepted: Accepted\./);
	assert.match((await p.tools.get("domain_state").execute("s", { domain: "lamp" })).content[0].text, /stage main/);
	const c = await p.tools.get("domain_clock").execute("k", { n: 3 });
	assert.match(c.content[0].text, /SURPRISE record 0: \{"lit":-1,"dark":1\}[\s\S]*clock: beat 3/);
	assert.equal(p.messages.length, 1);
	assert.equal(p.messages[0].opts.deliverAs, "steer");
	assert.match(p.messages[0].msg.content, /signals a surprise/);
	await p.emit("session_shutdown", {}, {});
});
