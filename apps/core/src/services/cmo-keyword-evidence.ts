import { z } from "zod";
import { type KeywordIdea, keywordIdeaSchema } from "@/lib/ads/dataforseo";
import {
  keywordKey,
  type NativeKeywordReceipt,
} from "@/lib/ads/native-keyword-ideas";

const DAY_MS = 86_400_000;
export const KEYWORD_EVIDENCE_MS = 30 * DAY_MS; // A month of monthly Labs measurements.
const evidenceSchema = z.object({
  source: z.enum(["suggestions", "overview"]),
  measuredAt: z.string().datetime(),
  taskId: z.string().nullable(),
  rows: z.array(keywordIdeaSchema),
});
export type KeywordEvidence = z.infer<typeof evidenceSchema>;
export const keywordSearchPayloadSchema = z.object({
  topic: z.string(),
  countryCode: z.string(),
  languageCode: z.string(),
  ideas: z.array(keywordIdeaSchema),
  exactKeywords: z.array(z.string()).optional(),
  baseline: evidenceSchema.nullable().optional(),
  native: evidenceSchema.optional(),
  priorOverviews: z.array(evidenceSchema).optional(),
});
export type StoredKeywordSearch = z.infer<typeof keywordSearchPayloadSchema> & {
  observedAt: Date;
};
export const currentEvidence = (
  packet: KeywordEvidence | null | undefined,
  now: Date,
) => {
  if (!packet) return null;
  const age = now.getTime() - Date.parse(packet.measuredAt);
  return age >= 0 && age < KEYWORD_EVIDENCE_MS ? packet : null;
};
export function newEvidence(
  source: KeywordEvidence["source"],
  measuredAt: Date,
  receipt: NativeKeywordReceipt,
  rows: KeywordIdea[],
): KeywordEvidence {
  const approved = new Set(receipt.exactKeywords);
  return {
    source,
    measuredAt: measuredAt.toISOString(),
    taskId: receipt.taskId,
    rows: rows.filter((i) => approved.has(keywordKey(i.keyword))),
  };
}
export function baselineOf(search: StoredKeywordSearch | undefined, now: Date) {
  if (!search) return null;
  // The previous format only marked rows bound to that search's native suggestions response.
  const baseline =
    search.baseline ??
    (!search.native && search.exactKeywords?.length
      ? newEvidence(
          "suggestions",
          search.observedAt,
          { taskId: null, costUsd: null, exactKeywords: search.exactKeywords },
          search.ideas.filter(
            (i) =>
              !i.measuredAt || i.measuredAt === search.observedAt.toISOString(),
          ),
        )
      : null);
  return baseline?.source === "suggestions" && baseline.rows.length
    ? currentEvidence(baseline, now)
    : null;
}
/** Save only original overview receipts from this topic. Copied baseline rows never extend that window. */
export function priorOverviews(
  search: StoredKeywordSearch | undefined,
  now: Date,
) {
  if (!search) return [];
  return [...(search.priorOverviews ?? []), search.native].filter(
    (p): p is KeywordEvidence =>
      p?.source === "overview" && currentEvidence(p, now) !== null,
  );
}

/** Use the original provider observation time, even if a more recent search also included that row. */
export function joinedMeasurements(searches: StoredKeywordSearch[], now: Date) {
  const packets = searches
    .flatMap((s) => [
      baselineOf(s, now),
      currentEvidence(s.native, now),
      ...priorOverviews(s, now),
    ])
    .filter((p) => p !== null)
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  const result = new Map<string, KeywordIdea>();
  for (const p of packets)
    for (const i of p.rows)
      result.set(keywordKey(i.keyword), { ...i, measuredAt: p.measuredAt });
  return result;
}
