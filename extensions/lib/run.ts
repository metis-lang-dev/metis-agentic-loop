// run — a run of the loop in a pi that loop.sh did not start (pi-release s-8e13f6a8): the
// package installed into the person's own pi, the loop started by its /metis-loop or
// /metis-seed template. What loop.sh --scratch lays out and exports for the hosted mode,
// made here in the run's directory (the directory pi runs in, or $METIS_LOOP_RUN), and
// only when a template starts a run: a pi session that never types one gets nothing.
//
//   DIR/catalog/   the catalog the loop writes (catalog_apply, catalog_edit): the catalog's
//                  tools, plant beside the new domain, the lamp's world (example/lamp/), or
//                  nothing but the tools for a seeded start
//   DIR/seed/      a seeded start's program (or package), served from outside the catalog
//   DIR/into/      catalog_take's target, unless $METIS_LOOP_TAKE_INTO names the person's catalog
//   DIR/records/   the run's records (formalize-calls.jsonl, the domain agent's surprises)
//   DIR/metis.toml the kernel's formalize endpoint (unless $METIS_CONFIG): pi's model's provider —
//                  openrouter (the loop SDK's OpenAI-compatible face, OPENROUTER_API_KEY) or ollama;
//                  $FORMALIZE_MODEL as in loop.sh
// The catalog the tools and plant come from is the loop SDK's (the metis-catalog wheel's, or a
// checkout at its root rule). Every write stays inside DIR.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, PIP } from "./sdk.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."); // the package's root
const NAME = /^[a-z][a-z0-9_]*$/;
const skip = (s: string) => !/(^|\/)(build|records|__pycache__)(\/|$)/.test(s);

export type Run = { dir: string; llp: string | null; text?: string };
type Model = { provider: string; id: string } | undefined;

function sdkPy(): string {
	return process.env.METIS_LOOP_SDK_PY || "python3";
}

function tools(src: string, to: string) {
	cpSync(join(src, "tools"), join(to, "tools"), { recursive: true, filter: skip });
}

/** The kernel's formalize endpoint, as loop.sh writes it: the driver's provider, thinking off. */
function formalize(dir: string, model: Model) {
	if (process.env.METIS_CONFIG) return;
	let m = process.env.FORMALIZE_MODEL || (model && ["ollama", "openrouter"].includes(model.provider) ? `${model.provider}/${model.id}` : "metis-gemma4-e4b");
	m = m.replace(/^ollama\//, "").replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
	const py = execFileSync(sdkPy(), ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
	let face: string;
	if (m.startsWith("openrouter/")) {
		if (!process.env.OPENROUTER_API_KEY) throw new Error(`formalize on ${m}: OPENROUTER_API_KEY from the environment`);
		face = `openai-command --base-url https://openrouter.ai/api/v1 --model ${m.slice("openrouter/".length)} --log ${join(dir, "records", "formalize-calls.jsonl")}`;
	} else {
		face = `ollama-command --model ${m} --url ${process.env.OLLAMA_URL || "http://127.0.0.1:11434"}`;
	}
	const conf = join(dir, "metis.toml");
	writeFileSync(conf, `[llm]\nendpoint = "command:${py} -m metis_loop_sdk.models ${face}"\n`);
	process.env.METIS_CONFIG = conf;
}

function exportRun(dir: string, src: string, model: Model) {
	const into = process.env.METIS_LOOP_TAKE_INTO || join(dir, "into");
	if (!process.env.METIS_LOOP_TAKE_INTO && !existsSync(join(into, "domains"))) {
		mkdirSync(join(into, "domains"), { recursive: true }); // a catalog of the person's: what a take brings, and the tools a build needs
		tools(src, into);
	}
	mkdirSync(join(dir, "records"), { recursive: true });
	Object.assign(process.env, {
		METIS_CATALOG: join(dir, "catalog"),
		METIS_LOOP_RECORDS: join(dir, "records"),
		METIS_LOOP_RUN: dir,
		METIS_LOOP_TAKE_INTO: into,
	});
	formalize(dir, model);
}

/** The catalog the run's tools and plant come from: the loop SDK's root. */
function source(): string {
	try {
		return catalog().root();
	} catch (e) {
		throw new Error(`no catalog to start from (${(e as Error).message.split("\n")[0]}): ${PIP}`);
	}
}

/** /metis-loop: the lamp's run (loop.sh --scratch DIR). */
export function loopRun(dir: string, model: Model): Run {
	const cat = join(dir, "catalog");
	if (existsSync(join(dir, "seed.json"))) throw new Error(`${dir} is a seeded run (${readFileSync(join(dir, "seed.json"), "utf8")}): /metis-seed it again, or start pi in a new directory`);
	const src = source();
	if (!existsSync(join(cat, "domains"))) {
		mkdirSync(join(cat, "domains", "lamp"), { recursive: true });
		tools(src, cat);
		cpSync(join(src, "domains", "plant"), join(cat, "domains", "plant"), { recursive: true, filter: skip }); // a known domain beside the new one
		cpSync(join(PKG, "example", "lamp", "lamp_host.py"), join(cat, "domains", "lamp", "lamp_host.py")); // the world, before any program
	}
	exportRun(dir, src, model);
	return { dir, llp: process.env.METIS_LOOP_LLP || join(cat, "domains", "plant", "plant.llp") };
}

/** /metis-loop TEXT: the template's body with TEXT verbatim for its `$@` (pi's own expansion
 *  splits arguments shell-like, so a person's prose loses its apostrophes and line breaks). */
export function loopText(text: string): string {
	const t = readFileSync(join(PKG, "prompts", "metis-loop.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
	return t.replace(/\$@\n?$/, text.trim());
}

/** Shell-like words: "a b" and 'a b' are one. */
export function words(s: string): string[] {
	return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** /metis-seed PATH [NAME] [EPISODES]: a seeded start (loop.sh --scratch DIR --seed PATH
 *  --name NAME --episodes N); text: the command with every argument filled in. */
export function seedRun(dir: string, cwd: string, args: string[], model: Model): Run {
	const [path, given, n] = args;
	if (!path) throw new Error("/metis-seed <path.llp|package dir> [name] [episodes]");
	const seed = resolve(cwd, path);
	if (!existsSync(seed)) throw new Error(`/metis-seed ${path}: no such file`);
	const pkg = statSync(seed).isDirectory();
	if (pkg && !existsSync(join(seed, "domain.yaml"))) throw new Error(`/metis-seed ${path}: a directory seed is a domain package (its domain.yaml)`);
	const name = given || basename(seed, ".llp").replaceAll("-", "_");
	if (!NAME.test(name)) throw new Error(`the domain name '${name}': lowercase letters, digits, _ (give it: /metis-seed ${path} NAME)`);
	const episodes = n ?? "20";
	if (!/^[1-9][0-9]*$/.test(episodes) || +episodes > 50) throw new Error(`episodes ${episodes}: 1-50 (domain_episodes' n)`);
	const src = source();
	const inSrc = relative(src, seed);
	const rel = inSrc && !inSrc.startsWith("..") && !isAbsolute(inSrc) ? inSrc : seed;
	const want = JSON.stringify({ seed: rel, name, ...(pkg ? { package: true } : {}) });
	const cat = join(dir, "catalog");
	if (existsSync(join(dir, "seed.json"))) {
		const had = readFileSync(join(dir, "seed.json"), "utf8");
		if (had !== want) throw new Error(`${dir} was seeded otherwise (${had}): start pi in a new directory`);
	} else if (existsSync(join(cat, "domains"))) {
		throw new Error(`${dir} has an unseeded catalog already: start pi in a new directory for a seeded start`);
	}
	if (!existsSync(join(cat, "domains"))) {
		mkdirSync(join(cat, "domains"), { recursive: true });
		tools(src, cat);
		if (pkg) {
			cpSync(seed, join(dir, "seed", "domains", name), { recursive: true, filter: skip }); // the package, a catalog of its own
			tools(src, join(dir, "seed"));
		} else {
			mkdirSync(join(dir, "seed"), { recursive: true });
			cpSync(seed, join(dir, "seed", `${name}.llp`));
		}
		writeFileSync(join(dir, "seed.json"), want);
	}
	exportRun(dir, src, model);
	const llp = pkg ? catalog().get(name, join(dir, "seed")).program : join(dir, "seed", `${name}.llp`);
	if (!llp) throw new Error(`/metis-seed ${path}: its domain.yaml names no program the loop SDK reads`);
	const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
	return { dir, llp, text: `/metis-seed ${q(rel)} ${name} ${episodes}` };
}
