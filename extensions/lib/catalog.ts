// The catalog through the loop SDK's CLI (catalog-sdk s-bc1718e3 step 2):
// `python -m metis_loop_sdk.catalog … --json`, the one access to
// metis-catalog. The extensions know no layout of the catalog and no
// domain.yaml of their own: what a domain has (get, intents --spec), the
// intent skeleton, and the one validated write (apply: domain.yaml through the
// loader's check, the intent files generated, never a commit) are the SDK's.
//
// Environment (loop.sh sets them):
//   METIS_LOOP_SDK_PY   a python with the loop SDK (metis_loop_sdk) installed
//   METIS_CATALOG       the catalog root (a scratch copy for trials); unset,
//                       the SDK's own rule (the metis-catalog checkout beside it)
import { execFileSync } from "node:child_process";

export type Planned = { path: string; new: boolean; diff: string };

/** The catalog root the writes go to: $METIS_CATALOG, which must be set. */
export function writeRoot(): string {
	const c = process.env.METIS_CATALOG;
	if (!c) throw new Error("METIS_CATALOG is not set: catalog_apply has nowhere to write");
	return c;
}

/** One CLI call: `catalog(["get", "lamp"])`; stdin for `-` arguments. Throws
 *  the SDK's own error ({"error"} on stdout, exit 1) as an Error. */
export function catalog(args: string[], input?: string): any {
	const py = process.env.METIS_LOOP_SDK_PY || "python3";
	const root = process.env.METIS_CATALOG ? ["--root", process.env.METIS_CATALOG] : [];
	try {
		return JSON.parse(
			execFileSync(py, ["-m", "metis_loop_sdk.catalog", ...root, ...args, "--json"], {
				input: input ?? "",
				encoding: "utf8",
				maxBuffer: 1 << 26,
			}),
		);
	} catch (e: any) {
		let err: string | undefined;
		try {
			err = JSON.parse(String(e.stdout ?? "")).error;
		} catch {
			// not the SDK's answer: the process itself failed
		}
		if (err) throw new Error(`catalog ${args[0]}: ${err}`);
		throw new Error(`catalog ${args[0]} (${py} -m metis_loop_sdk.catalog): ${String(e.stderr || e.message).trim().slice(-500)}`);
	}
}
