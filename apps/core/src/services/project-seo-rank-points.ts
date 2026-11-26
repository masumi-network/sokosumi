import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { seoKeywordIdentity } from "./project-seo-keyword-rows";
import { sha256 } from "./project-seo-store";

/**
 * Result kinds whose Run reads keyword positions: "rankings", "audit_lite" when it asks for it, and a full audit.
 * A "page_check" lists keywords and reads no position.
 */
export const SEO_RANK_POINT_KINDS = ["rankings", "audit_lite", "audit_full"];

/** A rank point as the table stores it, without its ID. */
export type SeoRankPointData = {
  observationId: string;
  key: string;
  observedAt: Date;
  position: number | null;
  positionStatus: string;
  checkedResults: number | null;
  device: string | null;
};

/** The key of a keyword's points: the identity a workspace keyword row has, at a fixed length. */
export function seoRankPointKey(
  row: Parameters<typeof seoKeywordIdentity>[0],
  countryCode: string,
  languageCode: string,
) {
  return sha256(seoKeywordIdentity(row, countryCode, languageCode));
}

/**
 * The rank points of a result: one per keyword identity, from its first row as the workspace reads it.
 * Only a read with an answer is a point: the page has a position, or it is not in the checked results.
 */
export function seoRankPoints(
  observationId: string,
  payload: Pick<
    PublicSeoPayload,
    "kind" | "keywords" | "countryCode" | "languageCode"
  >,
): SeoRankPointData[] {
  if (!SEO_RANK_POINT_KINDS.includes(payload.kind)) return [];
  const seen = new Set<string>();
  const points: SeoRankPointData[] = [];
  for (const item of payload.keywords) {
    const key = seoRankPointKey(
      item,
      payload.countryCode,
      payload.languageCode,
    );
    // The first row of an identity is the workspace row. A later row must not take its place.
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.positionStatus === "unavailable") continue;
    points.push({
      observationId,
      key,
      observedAt: new Date(item.observedAt),
      position: item.position,
      positionStatus: item.positionStatus,
      checkedResults: item.checkedResults,
      device: item.device,
    });
  }
  return points;
}
