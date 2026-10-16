// metis-repl — the metis REPL as pi tools (docs/LOOP-AGENT.md; agentic-loop
// s-3ddb3e87). One `metis --json` process per pi session (the REPL's JSON-lines
// wire, metis.loop.wire): the tools are generated from the wire's own `help`
// — its verb list and the descriptions it declares; a verb it declares
// without a description gets no words from here (a finding against metispy,
// marked in the tool's description). No logic of its own, except the one
// write the wire never makes: catalog_apply, behind pi's tool_call gate (the
// person approves every write into the catalog).
//
// Environment (tools/pi/loop.sh sets them):
//   METIS_LOOP_METIS   the metis console script (metispy's `metis`)
//   METIS_CATALOG      the catalog catalog_apply writes into (a scratch copy for trials)
//   METIS_CONFIG       the kernel's dot file ([llm]: formalize's endpoint)
//   METIS_LOOP_LLP     optional: the program the REPL starts on (else a blank world)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cap, JsonlChild, type Line } from "./lib/jsonl.ts";

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

	function open(llp: string | null, host: string | null) {
		repl?.close();
		const args = ["--json", ...(host ? ["--host", host] : []), ...(llp ? [llp] : [])];
		repl = new JsonlChild(metis(), args, { env: process.env, cwd: llp ? dirname(llp) : process.cwd() }, (l) =>
			signal(l),
		);
		served = llp;
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

	const catalog = () => {
		const c = process.env.METIS_CATALOG;
		if (!c) throw new Error("METIS_CATALOG is not set: catalog_apply has nowhere to write");
		return c;
	};
	type Plan = { path: string; content: string; manifest?: { path: string; content: string }; reopen?: { llp: string; host: string | null } };

	async function plan(p: { domain: string; what: string; name?: string }): Promise<Plan> {
		if (!NAME.test(p.domain)) throw new Error(`domain ${JSON.stringify(p.domain)}: lowercase letters, digits, _`);
		const dir = join(catalog(), "domains", p.domain);
		if (p.what === "intents") {
			const py = process.env.METIS_LOOP_PYTHON || "python3";
			const content = execFileSync(py, [join(catalog(), "tools", "intents.py"), "skeleton", p.domain], {
				env: { ...process.env, METIS_CATALOG: catalog() },
				encoding: "utf8",
			});
			return { path: join(dir, "intent.yaml"), content };
		}
		const st = await op("show");
		if (!st.candidate) throw new Error("no candidate in the REPL: formalize (or mine + formalize) first");
		if (!st.gated) throw new Error("the candidate has not passed the gate: run repl_gate (an extension) or repl_revise (a program) until it does");
		const cand = String((await op("show", "llp")).llp ?? "");
		if (p.what === "program") {
			const llp = join(dir, `${p.domain}.llp`);
			const hostFile = join(dir, `${p.domain}_host.py`);
			const host = existsSync(hostFile) ? `${p.domain}_host.py:make` : null;
			const yaml = join(dir, "domain.yaml");
			const manifest = existsSync(yaml)
				? undefined
				: {
						path: yaml,
						content:
							`# written by the agentic loop's catalog_apply (docs/LOOP-AGENT.md)\nprogram: ${p.domain}.llp\n` +
							(host ? `host: ${host}\n` : "") +
							`clock: {beats: 1}\nrecords: records/\n`,
					};
			return { path: llp, content: cand.endsWith("\n") ? cand : `${cand}\n`, manifest, reopen: { llp, host: host ? `${hostFile}:make` : null } };
		}
		if (p.what === "extension") {
			const name = p.name && NAME.test(p.name) ? p.name : "";
			if (!name) throw new Error("an extension needs a name (lowercase): it is written to domains/<domain>/extensions/<name>.llp");
			return { path: join(dir, "extensions", `${name}.llp`), content: cand.endsWith("\n") ? cand : `${cand}\n` };
		}
		throw new Error(`what: program | extension | intents, not ${JSON.stringify(p.what)}`);
	}

	const plans = new Map<string, Plan>(); // toolCallId -> the plan the person approved

	pi.registerTool({
		name: "catalog_apply",
		label: "apply to the catalog",
		description:
			"Write into the catalog (the person approves each write): what=program writes the REPL's gated candidate as domains/<domain>/<domain>.llp " +
			"(and a domain.yaml when there is none), then the REPL serves it; what=extension writes it as domains/<domain>/extensions/<name>.llp; " +
			"what=intents writes a first intent.yaml drafted from the domain's program (its cmd_* atoms and %% lines).",
		parameters: Type.Object({
			domain: Type.String({ description: "the domain's name: lowercase letters, digits, _" }),
			what: Type.Union([Type.Literal("program"), Type.Literal("extension"), Type.Literal("intents")]),
			name: Type.Optional(Type.String({ description: "what=extension: the extension's file name, without .llp" })),
		}),
		async execute(id, params) {
			const pl = plans.get(id);
			plans.delete(id);
			if (!pl) throw new Error("not approved");
			for (const f of [pl, ...(pl.manifest ? [pl.manifest] : [])]) {
				mkdirSync(dirname(f.path), { recursive: true });
				writeFileSync(f.path, f.content);
			}
			if (params.what === "intents") {
				const py = process.env.METIS_LOOP_PYTHON || "python3";
				execFileSync(py, [join(catalog(), "tools", "intents.py"), "gen", params.domain], { env: { ...process.env, METIS_CATALOG: catalog() } });
			}
			let after = "";
			if (pl.reopen) {
				open(pl.reopen.llp, pl.reopen.host);
				await registerVerbs();
				after = ` The REPL now serves ${pl.reopen.llp}${pl.reopen.host ? " with its host" : ""}.`;
			}
			const written = [pl.path, ...(pl.manifest ? [pl.manifest.path] : [])];
			return { content: [{ type: "text", text: `applied: ${written.join(", ")}.${after}` }], details: { written } };
		},
	});

	// the gate: every catalog_apply waits for the person's confirmation in pi
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "catalog_apply") return undefined;
		let pl: Plan;
		try {
			pl = await plan(event.input as { domain: string; what: string; name?: string });
		} catch (e) {
			return { block: true, reason: (e as Error).message };
		}
		if (!ctx.hasUI) return { block: true, reason: "no person to approve the write (no UI)" };
		const prev = existsSync(pl.path) ? readFileSync(pl.path, "utf8") : null;
		const head = pl.content.split("\n").slice(0, 40).join("\n");
		const ok = await ctx.ui.confirm(
			`Apply to the catalog: ${pl.path}${prev === null ? " (new)" : " (replaces the file)"}?`,
			`${head}${pl.content.split("\n").length > 40 ? "\n…" : ""}${pl.manifest ? `\n\n+ ${pl.manifest.path}:\n${pl.manifest.content}` : ""}`,
		);
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
