// sdk — the loop SDK's TypeScript face, the catalog the extensions call (pi-release
// s-8e13f6a8, rule 1): resolved where the SDK is installed, never copied or linked here.
// The directory `python -m metis_loop_sdk.catalog ts --json` names in the SDK's python
// ($METIS_LOOP_SDK_PY, else python3 on PATH) holds catalog.ts; it is loaded from there on
// the first call (a function, so loop.sh's or the tests' environment is the one read), so
// the py SDK and its face are one install and one tag, hosted or installed alike.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

/** What a person installs for the extensions' python side. */
export const PIP = "pip install metispy metis-catalog metis-loop-sdk";

// the face's types by name, for the extensions' annotations (erased as they run; the
// face declares them: metis_loop_sdk/ts/catalog.ts)
export type Planned = any;
export type Applied = any;
export type Write = any;
export type Edit = any;

const require = createRequire(import.meta.url);
const faces = new Map<string, any>(); // by python

const sdkPy = () => process.env.METIS_LOOP_SDK_PY || "python3";

/** The face's directory, as the SDK's python says; a python without the SDK is refused
 *  with the line that installs it. */
export function faceDir(py = sdkPy()): string {
	let out: string;
	try {
		out = execFileSync(py, ["-m", "metis_loop_sdk.catalog", "ts", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		const why = String((e as any).stderr || (e as Error).message).trim().split("\n").pop();
		throw new Error(`no loop SDK in ${py} (METIS_LOOP_SDK_PY, else python3 on PATH): ${PIP} — ${why}`);
	}
	return JSON.parse(out).dir;
}

/** The face (catalog.ts in faceDir()), loaded once per python. */
export function catalog(): any {
	const py = sdkPy();
	let f = faces.get(py);
	if (!f) faces.set(py, (f = require(join(faceDir(py), "catalog.ts"))));
	return f;
}
