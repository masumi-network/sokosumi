import { z } from "@hono/zod-openapi";
import { seoPageMarketEvidence } from "@/schemas/seo-audit-coverage.schema";
import { publicExplorationUrl } from "./project-seo-exploration-privacy";
import type { PublicSeoPayload } from "./project-seo-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";

const workerEvidence = seoPageMarketEvidence.extend({
  comparisonNote: z.literal(
    "This page audit did not measure competitor visibility by country and language.",
  ),
});

/** Trust regional page addresses only on the audited origin or its observed www alias. */
export function readPageMarketEvidence(
  raw: unknown,
  requested: string,
  finals: (string | null | undefined)[],
) {
  const result = workerEvidence.safeParse(raw);
  if (!result.success) return undefined;
  const start = new URL(requested);
  const origins = new Set([start.origin]);
  for (const final of finals) {
    const url = final && URL.parse(final);
    if (
      url &&
      url.protocol === start.protocol &&
      url.port === start.port &&
      (url.hostname === "www." + start.hostname ||
        start.hostname === "www." + url.hostname)
    ) {
      origins.add(url.origin);
    }
  }
  return {
    regionalVersions: result.data.regionalVersions.filter(
      ({ url }) =>
        publicExplorationUrl(url) &&
        !/[?#]/.test(url) &&
        origins.has(new URL(url).origin),
    ),
  };
}

/** A page report cannot assign its regional versions to another selected page. */
export function scopedPageMarketEvidence(
  data: PublicSeoPayload,
  selected: ReadonlySet<string>,
) {
  return data.kind === "audit_full" &&
    data.pageUrls.length === 1 &&
    data.pageMarketEvidence &&
    selected.has(auditedSeoPageKey(data.pageUrls[0]!))
    ? { pageMarketEvidence: data.pageMarketEvidence }
    : {};
}
