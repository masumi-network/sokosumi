import type { SokoBotSourceCoverage } from "@sokosumi/soko-bot";

/** Coverage is evidence about a query, never a claim that a source is empty. */
export function buildSourceCoverage(
  input: SokoBotSourceCoverage,
): SokoBotSourceCoverage {
  if (input.availability !== "AVAILABLE") {
    return {
      ...input,
      scannedCount: 0,
      includedCount: 0,
      omittedCount: 0,
      completeness: "NOT_CHECKED",
    };
  }
  return {
    ...input,
    completeness: input.omittedCount > 0 ? "TRUNCATED" : input.completeness,
  };
}
