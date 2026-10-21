// metis-repl — the metis REPL as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `metis --json` process per pi session (the REPL's JSON-lines
// wire, metis.loop.wire): the tools are generated from the wire's own `help`
// — its verb list and the descriptions it declares; a verb it declares
// without a description gets no words from here (a finding against metispy,
// marked in the tool's description). No logic of its own, except the one
// write the wire never makes: catalog_apply, behind pi's tool_call gate (the
// person approves every write into the catalog); catalog_edit, one exact edit of a
// domain's file (comments and all), behind the same gate; and catalog_take, which
// takes a finished domain from the loop's catalog into the person's, behind it too.
// Their rules are the loop SDK's gate (metis_loop_sdk.gate, ./sdk/gate.ts; metis-loop
// docs/LOOP.md), the policy the human loop's console follows too: propose, the person
// reads the plan, confirm writes exactly it; a refused file's next proposal shows what
// changed since; the seed first; an applied program that won't load never replaces the one served.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_METIS   the metis console script (metispy's `metis`)
//   METIS_CATALOG      the catalog catalog_apply writes into (loop.sh: the directory it starts in)
//   METIS_LOOP_SDK_PY  a python with the loop SDK: the catalog is its (./sdk: its TypeScript face, setup.sh links it)
//   METIS_CONFIG       the kernel's dot file ([llm]: formalize's endpoint)
//   METIS_LOOP_LLP     optional: the program the REPL starts on (else a blank world)
//   METIS_LOOP_TAKE_INTO the catalog catalog_take takes a domain into (loop.sh --into DIR2; none: it refuses)
//   METIS_LOOP_RUN     the loop's state (DIR/.metis/: records/, seed/, seed.json), for the taken domain's README
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import { runDir, takeRoot, writeRoot } from "./lib/roots.ts";
import * as catalog from "./sdk/catalog.ts";
import * as gate from "./sdk/gate.ts";

const NO_WORDS = "(the REPL's wire declares no description for this verb — finding: metispy)";
const ARG = Type.Object({
	arg: Type.Optional(Type.String({ description: "everything after the verb on the REPL line, as a person types it (empty for the bare verb)" })),
});
const NAME = /^[a-z][a-z0-9_]*$/;

export default function (pi: ExtensionAPI) {
	let repl: JsonlChild | null = null;
	let served: string | null = null; // the program file the REPL serves (null: a blank world)
	let servedHost: string | null = null; // the host it was started with (--host: the operator's argv, D4)
	const registered = new Set<string>();
	const metis = () => process.env.METIS_LOOP_METIS || "metis";

	function spawn(llp: string | null, host: string | null): JsonlChild {
		const args = ["--json", ...(host ? ["--host", host] : []), ...(llp ? [llp] : [])];
		return new JsonlChild(metis(), args, { env: process.env, cwd: llp ? dirname(llp) : process.cwd() }, (l) => signal(l));
	}

	function open(llp: string | null, host: string | null) {
		repl?.close();
		repl = spawn(llp, host);
		served = llp;
		servedHost = host;
	}

	// serve another program: an applied program that won't load never replaces the one served
	// (docs/LOOP.md). With the same host, the kernel's own wire `reload` re-serves in place and
	// keeps the program, its candidate and the session when the new one cannot load; another
	// host is a new process (D4: a host is named on argv only), the one that was serving until
	// the new one answers. null on success, else why it failed.
	async function reopen(llp: string, host: string | null): Promise<string | null> {
		if (repl && host === servedHost) {
			const r = await op("reload", llp);
			if (!(r.ok === false && /unknown op 'reload'/.test(String(r.error ?? "")))) { // a metispy before reload: a new process
				if (r.ok === false) return JSON.stringify(r.findings ?? r);
				served = llp;
				await registerVerbs();
				return null;
			}
		}
		const old = repl, oldServed = served, oldHost = servedHost;
		repl = spawn(llp, host);
		served = llp;
		servedHost = host;
		try {
			const h = await op("help"); // metis answers a program it cannot load with ok:false (and exits)
			if (h.ok === false) throw new Error(JSON.stringify(h.findings ?? h));
			await registerVerbs();
			old?.close();
			return null;
		} catch (e) {
			repl.close();
			repl = old;
			served = oldServed;
			servedHost = oldHost;
			return (e as Error).message;
		}
	}

	// a watch's signal lines (event / quiescence / surprise), unasked: into the loop
	function signal(l: Line) {
		pi.sendMessage({ customType: "metis-repl-signal", content: `REPL signal: ${JSON.stringify(l)}`, display: true }, { deliverAs: "steer", triggerTurn: true });
	}

	async function op(verb: string, arg = ""): Promise<Line> {
		if (!repl) throw new Error("the REPL is not running");
		const lines = await repl.request({ op: verb, arg }, (l) => "ok" in l || "error" in l || "findings" in l);
		for (const l of lines.slice(0, -1)) signal(l); // a watch's lines that came before the answer
		return lines[lines.length - 1];
	}

	function text(res: Line): string {
		if (typeof res.text === "string" && res.ok) return res.text;
		const { ok, ...rest } = res;
		return `${ok === false ? "refused: " : ""}${JSON.stringify(rest)}`;
	}

	async function registerVerbs() {
		const help = await op("help");
		const ops = (help.ops as string[]) || [];
		const words = (help.descriptions as Record<string, string>) || {};
		for (const verb of ops) {
			if (!NAME.test(verb) || registered.has(verb)) continue;
			registered.add(verb);
			pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
				name: `repl_${verb}`,
				label: `metis ${verb}`,
				description: `metis REPL \`${verb}\`: ${words[verb] ?? NO_WORDS}`,
				parameters: ARG,
				async execute(_id, params) {
					const res = await op(verb, (params.arg ?? "").trim());
					return { content: [{ type: "text", text: cap(text(res)) }], details: { verb, arg: params.arg ?? "", result: res } };
				},
			});
		}
		return { ops: ops.length, undescribed: ops.filter((v) => !words[v]) };
	}

	// ---- the catalog's writes, gated: the loop SDK's gate (loop-parity s-72d9d36b) ----------
	// The policy is the SDK's (metis_loop_sdk.gate, its TypeScript face ./sdk/gate.ts): a write is a
	// proposal, its plan the files it writes with their diffs; the person reads it at pi's tool_call
	// gate, then the tool confirms it, which writes exactly that plan; a refused proposal is
	// remembered (its next plan shows what changed since); the seed-first and README-refused rules
	// and the take into another catalog are its. Here: what only this host has — the REPL's
	// candidate and the program it serves, the person at pi's confirm, and serving the program after.

	type Tool = "catalog_apply" | "catalog_edit" | "catalog_take";
	type Plan = gate.Plan & { tool: Tool };
	type ApplyArgs = { domain: string; what: string; name?: string; text?: string; title?: string; display?: string; line?: string };
	type EditArgs = { domain: string; path: string; old_string: string; new_string: string; replace_all?: boolean };

	// the proposal of a tool call: the REPL's part first (its candidate, what it serves), then the gate's
	async function propose(tool: Tool, input: any): Promise<Plan> {
		const o = { root: writeRoot(), state: runDir() };
		if (tool === "catalog_take") {
			const into = takeRoot();
			return { ...gate.propose("take", input.domain, { src: o.root }, { ...o, root: into }), tool };
		}
		if (tool === "catalog_edit") {
			const p = input as EditArgs;
			return { ...gate.propose("edit", p.domain, { path: p.path, old: p.old_string, new: p.new_string, replace_all: !!p.replace_all }, o), tool };
		}
		const p = input as ApplyArgs;
		const args: Record<string, unknown> = {};
		for (const k of ["display", "line", "title", "name"] as const) if (p[k] !== undefined) args[k] = p[k];
		if (p.what === "readme") args.text = p.text ?? "";
		if (p.what === "served") {
			// the program the REPL serves, as it is (loop.sh --seed: the seed): no candidate, no rule changed
			// (a package seed comes whole from the seed's catalog: the gate does not read it)
			if (served && existsSync(served)) args.text = readFileSync(served, "utf8");
		} else if (p.what === "program" || p.what === "extension") {
			const st = await op("show");
			if (!st.candidate) throw new Error("no candidate in the REPL: formalize (or mine + formalize) first");
			if (!st.gated) throw new Error("the candidate has not passed the gate: run repl_gate (an extension) or repl_revise (a program) until it does");
			let text = String((await op("show", "llp")).llp ?? "");
			if (!text.endsWith("\n")) text += "\n";
			args.text = text;
		} else if (p.what !== "intents" && p.what !== "readme") {
			throw new Error(`what: program | served | extension | intents | readme, not ${JSON.stringify(p.what)}`);
		}
		return { ...gate.propose(p.what as gate.Kind, p.domain, args, o), tool };
	}

	const plans = new Map<string, Plan>(); // toolCallId -> the plan the person approved

	// an approved plan's write (the gate's confirm), the REPL serving the program again when it was written
	async function execute(id: string, tool: Tool) {
		const pl = plans.get(id);
		plans.delete(id);
		if (!pl || pl.tool !== tool) throw new Error("not approved");
		const out = gate.confirm(pl.token, runDir());
		if (out.note) return { content: [{ type: "text" as const, text: out.note + "." }], details: { written: [], note: out.note } };
		const written: string[] = out.written;
		let after = "";
		if (out.serve) {
			// the program and its host as the catalog's loader names them
			const { program, host } = out.serve;
			const failed = await reopen(program, host);
			after = failed
				? ` But metis cannot load the program it wrote: ${failed.slice(0, 600)}. The REPL still serves what it served before, its candidate kept: repair the text, formalize, check and apply again.`
				: ` The REPL now serves ${program}${host ? " with its host" : ""}.`;
		}
		return {
			content: [{ type: "text" as const, text: `applied: ${written.length ? written.join(", ") : "nothing (the catalog has it already)"}.${after}${pl.say ?? ""}` }],
			details: { written, fingerprint: out.fingerprint },
		};
	}

	pi.registerTool({
		executionMode: "sequential", // the tools share one process: one call at a time
		name: "catalog_apply",
		label: "apply to the catalog",
		description:
			"Write into the catalog (the person approves each write): what=program writes the REPL's gated candidate as the domain's program " +
			"(and a domain.yaml when there is none), then the REPL serves it; what=served writes the program the REPL serves, as it is " +
			"(a seed: its rules unchanged); what=extension writes the candidate as domains/<domain>/extensions/<name>.llp; " +
			"what=intents writes a first intent.yaml drafted from the domain's program (its cmd_* atoms and %% lines) and generates its files " +
			"(a world with no commands may get none); what=readme writes the domain's README.md: you give the title and the summary paragraph, " +
			"the SDK writes the rest from the files (where it came from, the program's header, how to run it, the intents). " +
			"A change to a file the catalog has already (a comment, a sentence, a value) is catalog_edit, not this.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			what: Type.Union([Type.Literal("program"), Type.Literal("served"), Type.Literal("extension"), Type.Literal("intents"), Type.Literal("readme")]),
			name: Type.Optional(Type.String({ description: "what=extension: the extension's file name, without .llp" })),
			text: Type.Optional(Type.String({ description: "what=readme: the summary paragraph — what the program tells, each claim from the program (a rule, a header line, a --run output shown here)" })),
			title: Type.Optional(Type.String({ description: "what=readme: what the world is, for the title line `# <domain> — <title>`" })),
			display: Type.Optional(Type.String({ description: "what=served|program: domain.yaml's display, this world's short name, from its program (a package seed keeps its own)" })),
			line: Type.Optional(Type.String({ description: "what=served|program: domain.yaml's line, one line on what this world is (a package seed keeps its own)" })),
		}),
		async execute(id) {
			return execute(id, "catalog_apply");
		},
	});

	pi.registerTool({
		executionMode: "sequential",
		name: "catalog_edit",
		label: "edit a catalog file",
		description:
			"Edit one file of a domain in the catalog as it is on disk: old_string replaced by new_string, every other byte (comments " +
			"above all) kept. Never formalize or revise for a small change — a comment, a sentence of the README, a value in domain.yaml " +
			"or intent.yaml, one rule's text: this is the tool. The person approves the diff. old_string must match the file exactly " +
			"(whitespace and all) and occur once, unless replace_all; a .llp edit must add no diagnostic. path is relative to the " +
			"domain's directory: <domain>.llp, extensions/<name>.llp, README.md, intent.yaml, domain.yaml.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			path: Type.String({ description: "the file, relative to the domain's directory (e.g. <domain>.llp, README.md)" }),
			old_string: Type.String({ description: "the exact text to replace (enough of it to occur once)" }),
			new_string: Type.String({ description: "the text to put in its place" }),
			replace_all: Type.Optional(Type.Boolean({ description: "replace every occurrence (default: exactly one)" })),
		}),
		async execute(id) {
			return execute(id, "catalog_edit");
		},
	});

	pi.registerTool({
		executionMode: "sequential",
		name: "catalog_take",
		label: "take into the person's catalog",
		description:
			"Only when the person asks: take a finished domain (its program, extensions, host, intents) from the loop's catalog into the " +
			"person's catalog, with a README of this run, and build its bundle. The person approves the diff; nothing is committed. " +
			"Refused when the person's catalog has the domain already.",
		parameters: Type.Object({ domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }) }),
		async execute(id) {
			const pl = plans.get(id);
			plans.delete(id);
			if (pl?.tool !== "catalog_take") throw new Error("not approved");
			const out = gate.confirm(pl.token, runDir());
			const bundle = out.bundle ?? "";
			return {
				content: [{ type: "text", text: `taken into ${pl.root}: ${out.written.join(", ")}. ${bundle}. Not committed: the person commits domains/${pl.domain} in that catalog.` }],
				details: { written: out.written, fingerprint: out.fingerprint, root: pl.root },
			};
		},
	});

	// the gate: every catalog_apply, catalog_edit and catalog_take waits for the person's confirmation in pi.
	// The whole diff: pi.sh runs the TUI in regular mode, so a long one stays in the scrollback. A file
	// refused before shows first what changed since that proposal, then its diff against the disk.
	pi.on("tool_call", async (event, ctx) => {
		const tool = event.toolName as Tool;
		if (tool !== "catalog_apply" && tool !== "catalog_edit" && tool !== "catalog_take") return undefined;
		let pl: Plan;
		try {
			pl = await propose(tool, event.input);
		} catch (e) {
			return { block: true, reason: (e as Error).message };
		}
		if (pl.note) {
			plans.set(event.toolCallId, pl); // nothing to write: no question for the person
			return undefined;
		}
		if (!ctx.hasUI) return { block: true, reason: "no person to approve the write (no UI)" };
		const mark = (f: catalog.Planned) =>
			`${f.path}${f.new ? " (new)" : ""}${f.since_diff === undefined ? "" : f.since_diff ? " (changed since you refused it)" : " (as you refused it)"}`;
		const what = pl.files.map(mark).join(", ") || "nothing changes";
		const body = pl.files.map((f) =>
			f.since_diff
				? `── ${f.path}: since the proposal you refused ──\n${f.since_diff}── ${f.path}: against the file on disk ──\n${f.diff}`
				: f.diff).join("").replace(/\n$/, "");
		const verb = pl.tool === "catalog_take" ? "Take into" : pl.tool === "catalog_edit" ? "Edit in" : "Apply to";
		const ok = await ctx.ui.confirm(`${verb} the catalog ${pl.root}: ${what}?`, body);
		if (!ok) {
			gate.refuse(pl.token, runDir()); // remembered: the next plan of these files shows what changed since
			return { block: true, reason: "the person did not approve this write" };
		}
		plans.set(event.toolCallId, pl);
		return undefined;
	});

	// a package seed's program is served with its host (its weight ports, its world), as the seed catalog names it
	function seedHost(llp: string | null): string | null {
		if (!llp) return null;
		try {
			const s = JSON.parse(readFileSync(join(runDir(), "seed.json"), "utf8"));
			if (!s.package) return null;
			const d = catalog.get(s.name, join(runDir(), "seed"));
			if (resolve(d.program) !== resolve(llp)) return null;
			return d.host && /\.py:/.test(d.host) ? join(dirname(d.program), d.host) : d.host ?? null;
		} catch {
			return null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const llp = process.env.METIS_LOOP_LLP || null;
		open(llp, seedHost(llp));
		const r = await registerVerbs();
		if (r.undescribed.length && ctx.hasUI)
			ctx.ui.notify(`metis-repl: ${r.ops} verbs; ${r.undescribed.length} without a description on the wire (finding: metispy): ${r.undescribed.join(" ")}`, "warning");
	});

	pi.on("session_shutdown", () => {
		repl?.close();
		repl = null;
	});

	pi.registerCommand("repl-served", {
		description: "what the metis REPL serves",
		handler: async (_a, ctx) => ctx.ui.notify(served ?? "a blank world", "info"),
	});
}
