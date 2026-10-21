// roots — which catalogs the loop's writes go to (the loop's own policy, from
// loop.sh's environment; the catalog itself is the loop SDK's, ./sdk/catalog.ts).
// A loop starts in a directory, and that directory is the catalog (cwd-root s-ddac2cbf).
//   METIS_CATALOG         the catalog the loop writes (catalog_apply): loop.sh sets it to DIR;
//                         unset, the cwd (the SDK's own rule)
//   METIS_LOOP_TAKE_INTO  the catalog catalog_take takes a finished domain into: named only
//   METIS_LOOP_RUN        the loop's state (records/, seed/, seed.json): DIR/.metis/, the taken domain's README
import { join, resolve } from "node:path";

/** The catalog root the loop writes: $METIS_CATALOG, else the cwd. */
export function writeRoot(): string {
	return process.env.METIS_CATALOG || process.cwd();
}

/** The catalog catalog_take takes a domain into: $METIS_LOOP_TAKE_INTO (loop.sh --into DIR2),
 *  never a default, never the one the loop writes. */
export function takeRoot(): string {
	const t = process.env.METIS_LOOP_TAKE_INTO;
	if (!t) throw new Error("catalog_take has no catalog to take the domain into: start the loop with --into DIR2 (or METIS_LOOP_TAKE_INTO=DIR2)");
	if (resolve(t) === resolve(writeRoot())) throw new Error(`METIS_LOOP_TAKE_INTO is the catalog the loop writes (${t}): the domain is there already`);
	return t;
}

/** The loop's state: $METIS_LOOP_RUN, else the catalog's .metis/ (the SDK's catalog.state()). */
export function runDir(): string {
	return process.env.METIS_LOOP_RUN || join(resolve(writeRoot()), ".metis");
}
