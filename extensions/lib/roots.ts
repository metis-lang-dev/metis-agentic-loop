// roots — which catalogs the loop's writes go to (the loop's own policy, from
// loop.sh's environment; the catalog itself is the loop SDK's, its TypeScript face: lib/sdk.ts).
//   METIS_CATALOG         the catalog the loop writes (catalog_apply): must be set
//   METIS_LOOP_TAKE_INTO  the catalog catalog_take takes a finished domain into
//   METIS_LOOP_RUN        the run's directory (records/, seed.json): the taken domain's README
import { dirname, resolve } from "node:path";

/** The catalog root the loop writes: $METIS_CATALOG, which must be set. */
export function writeRoot(): string {
	const c = process.env.METIS_CATALOG;
	if (!c) throw new Error("METIS_CATALOG is not set: catalog_apply has nowhere to write");
	return c;
}

/** The catalog catalog_take takes a domain into: $METIS_LOOP_TAKE_INTO (loop.sh
 *  --scratch: the metis-catalog checkout), never the one the loop writes. */
export function takeRoot(): string {
	const t = process.env.METIS_LOOP_TAKE_INTO;
	if (!t) throw new Error("METIS_LOOP_TAKE_INTO is not set: catalog_take has no catalog to take the domain into");
	if (resolve(t) === resolve(writeRoot())) throw new Error(`METIS_LOOP_TAKE_INTO is the catalog the loop writes (${t}): the domain is there already`);
	return t;
}

/** The run's directory: $METIS_LOOP_RUN, else the one the loop's catalog is in (loop.sh --scratch DIR: DIR). */
export function runDir(): string {
	return process.env.METIS_LOOP_RUN || dirname(resolve(writeRoot()));
}
