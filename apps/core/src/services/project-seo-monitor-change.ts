import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import {
  SEO_MONITOR_CHANGE_ITEMS,
  type SeoMonitorChange,
} from "@/schemas/project-seo-monitor.schema";

import { normalizeSeoUrl } from "./project-seo-store";

/**
 * The SERP noise band of the seo-bot Recheck (research 51, measured 2026-10-15): a move from a start rank counts as
 * real only when it is more than this many places. A start rank past the last bucket has no band: not compared.
 */
export const SEO_RANK_NOISE_BANDS = [
  { maxRank: 3, places: 2 },
  { maxRank: 10, places: 5 },
  { maxRank: 20, places: 7 },
] as const;

export function seoRankNoiseBand(rank: number): number | null {
  if (rank < 1) return null;
  return (
    SEO_RANK_NOISE_BANDS.find((band) => rank <= band.maxRank)?.places ?? null
  );
}

/** A move beyond the band. A page absent or unranked in either read is not determined, never a drop. */
export function isSeoRankMove(from: number, to: number): boolean {
  const band = seoRankNoiseBand(from);
  return band !== null && to >= 1 && Math.abs(to - from) > band;
}

export interface SeoMonitorRunResult {
  observedAt: Date;
  payload: PublicSeoPayload;
}

const identity = (pageUrl: string, ...parts: Array<string | null>) =>
  JSON.stringify([normalizeSeoUrl(pageUrl), ...parts]);

function checkResults(payload: PublicSeoPayload) {
  const results = new Map<string, PublicSeoPayload["checks"][number]>();
  for (const check of payload.checks)
    if (check.result === "pass" || check.result === "fired")
      results.set(identity(check.pageUrl, check.rowId, check.device), check);
  return results;
}

function findingTitle(payload: PublicSeoPayload, key: string) {
  return payload.findings.find(
    (finding) =>
      identity(finding.pageUrl, finding.rowId, finding.device) === key,
  )?.title;
}

function rankedKeywords(payload: PublicSeoPayload) {
  const ranked = new Map<string, PublicSeoPayload["keywords"][number]>();
  for (const row of payload.keywords) {
    if (row.positionStatus !== "ranked" || row.position === null) continue;
    const key = identity(
      row.pageUrl,
      row.keyword.normalize("NFKC").toLowerCase(),
      row.device,
    );
    if (!ranked.has(key)) ranked.set(key, row);
  }
  return ranked;
}

/** What the newest monitor Run changed against the one before. Only checks read in both Runs count. */
export function compareSeoMonitorRuns(
  previous: SeoMonitorRunResult,
  latest: SeoMonitorRunResult,
): SeoMonitorChange {
  const base = {
    from: previous.observedAt.toISOString(),
    to: latest.observedAt.toISOString(),
  };
  const before = previous.payload,
    after = latest.payload;
  if (
    before.countryCode !== after.countryCode ||
    before.languageCode !== after.languageCode ||
    before.rulebookVersion !== after.rulebookVersion
  )
    return {
      ...base,
      comparable: false,
      newFailureCount: 0,
      fixedCount: 0,
      newFailures: [],
      fixed: [],
      moves: [],
      moveCount: 0,
      dropCount: 0,
    };
  const earlier = checkResults(before);
  const newFailures: SeoMonitorChange["newFailures"] = [];
  const fixed: SeoMonitorChange["fixed"] = [];
  for (const [key, check] of checkResults(after)) {
    const old = earlier.get(key);
    if (!old || old.result === check.result) continue;
    const failed = check.result === "fired";
    (failed ? newFailures : fixed).push({
      rowId: check.rowId,
      title: findingTitle(failed ? after : before, key) ?? check.rowId,
      pageUrl: check.pageUrl,
      device: check.device,
    });
  }
  const earlierRanks = rankedKeywords(before);
  const moves: SeoMonitorChange["moves"] = [];
  for (const [key, row] of rankedKeywords(after)) {
    const from = earlierRanks.get(key)?.position;
    if (from == null || !isSeoRankMove(from, row.position!)) continue;
    moves.push({
      keyword: row.keyword,
      pageUrl: row.pageUrl,
      device: row.device,
      from,
      to: row.position!,
    });
  }
  // Drops first: they are what the reader acts on.
  moves.sort((a, b) => b.to - b.from - (a.to - a.from));
  return {
    ...base,
    comparable: true,
    newFailureCount: newFailures.length,
    fixedCount: fixed.length,
    newFailures: newFailures.slice(0, SEO_MONITOR_CHANGE_ITEMS),
    fixed: fixed.slice(0, SEO_MONITOR_CHANGE_ITEMS),
    moves: moves.slice(0, SEO_MONITOR_CHANGE_ITEMS),
    moveCount: moves.length,
    dropCount: moves.filter((move) => move.to > move.from).length,
  };
}

/** Worse: a check that passed now fails, or a ranked keyword fell beyond the band. */
export function isSeoMonitorChangeWorse(change: SeoMonitorChange): boolean {
  return (
    change.comparable && (change.newFailureCount > 0 || change.dropCount > 0)
  );
}
