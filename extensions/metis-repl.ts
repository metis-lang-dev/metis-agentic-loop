// metis-repl — the metis REPL as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `metis --json` process per pi session (the REPL's JSON-lines
// wire, metis.loop.wire): the tools are generated from the wire's own `help`
// — its verb list and the descriptions it declares; a verb it declares
// without a description gets no words from here (a finding against metispy,
// marked in the tool's description). No logic of its own, except the one
// write the wire never makes: catalog_apply, behind pi's tool_call gate (the
// person approves every write into the catalog), and catalog_take, which takes a
// finished domain from the loop's catalog into the person's, behind the same gate.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_METIS   the metis console script (metispy's `metis`)
//   METIS_CATALOG      the catalog catalog_apply writes into (a scratch copy for trials)
//   METIS_LOOP_SDK_PY  a python with the loop SDK: the catalog is its (./sdk: its TypeScript face, setup.sh links it)
//   METIS_CONFIG       the kernel's dot file ([llm]: formalize's endpoint)
//   METIS_LOOP_LLP     optional: the program the REPL starts on (else a blank world)
//   METIS_LOOP_TAKE_INTO the catalog catalog_take takes a domain into (loop.sh --scratch: metis-catalog)
//   METIS_LOOP_RUN     the run's directory (loop.sh --scratch DIR: records/, seed.json), for the taken domain's README
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";
import { runDir, takeRoot, writeRoot } from "./lib/roots.ts";
import * as catalog from "./sdk/catalog.ts";

const NO_WORDS = "(the REPL's wire declares no description for this verb — finding: metispy)";
const ARG = Type.Object({
	arg: Type.Optional(Type.String({ description: "everything after the verb on the REPL line, as a person types it (empty for the bare verb)" })),
});
const NAME = /^[a-z][a-z0-9_]*$/;

export default function (pi: ExtensionAPI) {
	let repl: JsonlChild | null = null;
	let served: string | null = null; // the program file the REPL serves (null: a blank world)
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
	}

	// serve another program; the REPL that was keeps serving (and keeps its
	// candidate) until the new one answers — a program metis cannot load leaves
	// the loop a REPL, not a dead process. null on success, else why it failed.
	async function reopen(llp: string, host: string | null): Promise<string | null> {
		const old = repl, oldServed = served;
		repl = spawn(llp, host);
		served = llp;
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

	// ---- catalog_apply: the one write, gated --------------------------------
	// through the loop SDK's catalog (its TypeScript face, ./sdk/catalog.ts: the
	// py SDK's CLI): the plan is its dry run (each file's diff, what the person
	// approves), the write its apply with the same text — domain.yaml checked by
	// the catalog's loader, the intent files generated, never a commit

	// root: the catalog the write goes to; run: the write the person approved
	type Plan = { domain: string; root: string; files: catalog.Planned[]; run: () => catalog.Applied; reopen: boolean; take?: boolean };

	async function plan(p: { domain: string; what: string; name?: string }): Promise<Plan> {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		if (!["program", "served", "extension", "intents"].includes(p.what))
			throw new Error(`what: program | served | extension | intents, not ${JSON.stringify(p.what)}`);
		const root = writeRoot();
		const planned = (w: catalog.Write, reopen = false): Plan => ({
			domain: p.domain, root, reopen, files: catalog.plan(p.domain, w, root), run: () => catalog.apply(p.domain, w, root),
		});
		if (p.what === "intents") {
			// a first intent.yaml drafted from the program; apply names it in domain.yaml (intent: {spec})
			return planned({ intents: catalog.skeleton(p.domain, root) });
		}
		let text: string;
		if (p.what === "served") {
			// the program the REPL serves, as it is (loop.sh --seed: the seed): no candidate, no rule changed
			if (!served) throw new Error("the REPL serves a blank world: there is no program to apply (loop.sh --seed starts it on one)");
			text = readFileSync(served, "utf8");
		} else {
			const st = await op("show");
			if (!st.candidate) throw new Error("no candidate in the REPL: formalize (or mine + formalize) first");
			if (!st.gated) throw new Error("the candidate has not passed the gate: run repl_gate (an extension) or repl_revise (a program) until it does");
			text = String((await op("show", "llp")).llp ?? "");
			if (!text.endsWith("\n")) text += "\n";
			if (p.what === "extension") {
				const name = p.name && NAME.test(p.name) ? p.name : "";
				if (!name) throw new Error("an extension needs a name (lowercase): it is written to domains/<domain>/extensions/<name>.llp");
				return planned({ extensions: { [name]: text } });
			}
		}
		let known = true;
		try {
			catalog.get(p.domain, root);
		} catch {
			known = false;
		}
		if (known) return planned({ program: text }, true);
		// a new domain: its manifest, the host beside the program when the world brought one
		const host = existsSync(join(root, "domains", p.domain, `${p.domain}_host.py`)) ? `${p.domain}_host.py:make` : null;
		const manifest =
			`# written by the agentic loop's catalog_apply (docs/LOOP-AGENT.md)\nprogram: ${p.domain}.llp\n` +
			(host ? `host: ${host}\n` : "") +
			`clock: {beats: 1}\nrecords: records/\n`;
		return planned({ program: text, manifest }, true);
	}

	// catalog_take: the SDK's take from the loop's catalog into the person's — the
	// domain's own files, with a README of the run (the SDK's readme) when it has none
	function planTake(p: { domain: string }): Plan {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		const from = writeRoot();
		const into = takeRoot();
		catalog.get(p.domain, from); // the loop's catalog has it (the SDK's error otherwise)
		const o = { readmeFromRun: runDir() };
		return { domain: p.domain, root: into, reopen: false, take: true,
			files: catalog.planTake(p.domain, from, o, into), run: () => catalog.take(p.domain, from, o, into) };
	}

	const plans = new Map<string, Plan>(); // toolCallId -> the plan the person approved

	pi.registerTool({
			executionMode: "sequential", // the tools share one process: one call at a time
		name: "catalog_apply",
		label: "apply to the catalog",
		description:
			"Write into the catalog (the person approves each write): what=program writes the REPL's gated candidate as the domain's program " +
			"(and a domain.yaml when there is none), then the REPL serves it; what=served writes the program the REPL serves, as it is " +
			"(a seed: its rules unchanged); what=extension writes the candidate as domains/<domain>/extensions/<name>.llp; " +
			"what=intents writes a first intent.yaml drafted from the domain's program (its cmd_* atoms and %% lines) and generates its files.",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			what: Type.Union([Type.Literal("program"), Type.Literal("served"), Type.Literal("extension"), Type.Literal("intents")]),
			name: Type.Optional(Type.String({ description: "what=extension: the extension's file name, without .llp" })),
		}),
		async execute(id) {
			const pl = plans.get(id);
			plans.delete(id);
			if (!pl || pl.take) throw new Error("not approved");
			const out = pl.run();
			const written: string[] = out.written;
			let after = "";
			if (pl.reopen) {
				// the program and its host as the catalog's loader names them
				const d = catalog.get(pl.domain, pl.root);
				const host = d.host && /\.py:/.test(d.host) ? join(dirname(d.program), d.host) : d.host;
				const failed = await reopen(d.program, host);
				after = failed
					? ` But metis cannot load the program it wrote: ${failed.slice(0, 600)}. The REPL still serves what it served before, its candidate kept: repair the text, formalize, check and apply again.`
					: ` The REPL now serves ${d.program}${host ? " with its host" : ""}.`;
			}
			return {
				content: [{ type: "text", text: `applied: ${written.length ? written.join(", ") : "nothing (the catalog has it already)"}.${after}` }],
				details: { written, fingerprint: out.fingerprint },
			};
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
			if (!pl?.take) throw new Error("not approved");
			const out = pl.run();
			let bundle: string;
			try {
				bundle = catalog.build(pl.domain, pl.root);
			} catch (e) {
				bundle = (e as Error).message;
			}
			return {
				content: [{ type: "text", text: `taken into ${pl.root}: ${out.written.join(", ")}. ${bundle}. Not committed: the person commits domains/${pl.domain} in that catalog.` }],
				details: { written: out.written, fingerprint: out.fingerprint, root: pl.root },
			};
		},
	});

	// the gate: every catalog_apply and catalog_take waits for the person's confirmation in pi.
	// The whole diff: pi.sh runs the TUI in regular mode, so a long one stays in the scrollback.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "catalog_apply" && event.toolName !== "catalog_take") return undefined;
		let pl: Plan;
		try {
			pl = event.toolName === "catalog_take"
				? planTake(event.input as { domain: string })
				: await plan(event.input as { domain: string; what: string; name?: string });
		} catch (e) {
			return { block: true, reason: (e as Error).message };
		}
		if (!ctx.hasUI) return { block: true, reason: "no person to approve the write (no UI)" };
		const what = pl.files.map((f) => `${f.path}${f.new ? " (new)" : ""}`).join(", ") || "nothing changes";
		const ok = await ctx.ui.confirm(`Apply to the catalog ${pl.root}: ${what}?`, pl.files.map((f) => f.diff).join("").replace(/\n$/, ""));
		if (!ok) return { block: true, reason: "the person did not approve this write" };
		plans.set(event.toolCallId, pl);
		return undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
		const llp = process.env.METIS_LOOP_LLP || null;
		open(llp, null);
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
