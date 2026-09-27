import { buildSourceCoverage } from "./source-coverage";

/** Integration adapters currently discard pagination tokens. Returned rows are
 * useful evidence, but cannot establish a complete search or a negative claim. */
export async function readSokoBotSource<T>(input: {
  source: string;
  filters: Record<string, string>;
  queries: (() => Promise<T[]>)[];
}) {
  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled(
    input.queries.map((query) => query()),
  );
  const rows = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const failedSources = results.filter(
    (result) => result.status === "rejected",
  ).length;
  return {
    rows,
    coverage: buildSourceCoverage({
      source: input.source,
      checkedAt,
      filters: input.filters,
      scannedCount: rows.length,
      includedCount: rows.length,
      omittedCount: 0,
      completeness: "TRUNCATED",
      availability: !results.length
        ? "DISCONNECTED"
        : failedSources === results.length
          ? "QUERY_FAILED"
          : "AVAILABLE",
    }),
    failedSources,
    note: "Only the returned records were checked. Provider pagination is not verified; do not infer that absent records do not exist.",
  };
}
