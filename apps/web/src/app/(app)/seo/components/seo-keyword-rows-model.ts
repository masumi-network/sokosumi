import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { normalizeQuery } from "./seo-search-model";

type Keyword = ProjectSeoWorkspace["keywords"][number];

/** A rank up to this one is on the first results page. */
export const SEO_FIRST_PAGE_RANK = 10;

const DEVICE_ORDER: Record<string, number> = { mobile: 0, desktop: 1 };

/** Why a check lists a keyword it read no position for. Every other source is a keyword the check set out to read. */
export const SEO_IDEA_SOURCES = ["gap", "opportunity"] as const;

export type SeoKeywordGroup = {
  /** Carries the row actions and the Search Console fallback; all rows of a group share one tracked state. */
  lead: Keyword;
  /** One position read per device, mobile first; a read without a device stands alone. Empty for an idea. */
  reads: Keyword[];
  volume: number | null;
  /** The best rank over the reads; null where the page is in none of the read results. */
  best: number | null;
  /** Why the check lists the keyword, for an idea ("gap", "opportunity"). */
  sources: string[];
};

/**
 * A check reports one keyword once per device, and again as a competitor gap or an idea.
 * The lists show it once: "checked" holds tracked keywords and the keywords a check set out to read,
 * "ideas" the keywords a check only lists as a competitor gap or an opportunity.
 */
export function keywordGroups(rows: Keyword[]) {
  const members = new Map<string, Keyword[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      normalizeQuery(row.keyword),
      row.countryCode,
      row.languageCode,
      row.pageUrl,
    ]);
    members.set(key, [...(members.get(key) ?? []), row]);
  }
  const groups = [...members.values()].map((group): SeoKeywordGroup => {
    const read = group.filter((row) => row.positionStatus !== "unavailable");
    // A keyword shows the reads of its newest check only: an older read of another
    // device, or an older read per device, would pass as a result of that check.
    const time = (row: Keyword) =>
      row.observedAt ? new Date(row.observedAt).getTime() : 0;
    const top = read.reduce<Keyword | null>(
      (best, row) => (best && time(best) >= time(row) ? best : row),
      null,
    );
    const latest = read.filter(
      (row) => row.observationId === top?.observationId,
    );
    // Rows come newest first: the first read of a device is its newest.
    const newest = new Map<string, Keyword>();
    for (const row of latest)
      if (row.device && !newest.has(row.device)) newest.set(row.device, row);
    const perDevice = [...newest.values()].toSorted(
      (left, right) =>
        (DEVICE_ORDER[left.device ?? ""] ?? 0) -
        (DEVICE_ORDER[right.device ?? ""] ?? 0),
    );
    const reads = perDevice.length ? perDevice : latest.slice(0, 1);
    const ranks = reads.flatMap((row) =>
      row.position === null ? [] : [row.position],
    );
    return {
      // The tracked row carries the saved choice the row actions change.
      lead: group.find((row) => row.saved) ?? reads[0] ?? group[0],
      reads,
      volume: group.find((row) => row.volume !== null)?.volume ?? null,
      best: ranks.length ? Math.min(...ranks) : null,
      sources: [...new Set(group.map((row) => row.source))],
    };
  });
  // Tracked keywords first, so a keyword the reader just tracked never hides behind "Show more".
  // Then the best rank, then the most searched: the keywords nearest to visitors lead.
  const byReach = (left: SeoKeywordGroup, right: SeoKeywordGroup) =>
    Number(right.lead.saved) - Number(left.lead.saved) ||
    (left.best ?? Number.POSITIVE_INFINITY) -
      (right.best ?? Number.POSITIVE_INFINITY) ||
    (right.volume ?? -1) - (left.volume ?? -1);
  // A focus keyword whose read failed is still a keyword of the check, not an idea.
  const checked = (group: SeoKeywordGroup) =>
    group.reads.length > 0 ||
    group.lead.saved ||
    group.sources.some(
      (source) => !SEO_IDEA_SOURCES.some((idea) => idea === source),
    );
  return {
    checked: groups.filter(checked).toSorted(byReach),
    ideas: groups.filter((group) => !checked(group)).toSorted(byReach),
  };
}

/** A keyword of a check whose position read failed: the check ran, so "not checked yet" would be wrong. */
export function keywordReadFailed(
  group: Pick<SeoKeywordGroup, "reads" | "sources">,
) {
  return (
    !group.reads.length &&
    group.sources.some(
      (source) =>
        source !== "saved" && !SEO_IDEA_SOURCES.some((idea) => idea === source),
    )
  );
}

/**
 * The first rows of the checked list: every tracked keyword, then the first "size" of the others.
 * The cut never hides a tracked keyword, and tracked keywords without a read never push every read out of view.
 */
export function keywordPage(checked: SeoKeywordGroup[], size: number) {
  const rest = checked.filter((group) => !group.lead.saved);
  const kept = new Set(rest.slice(0, size));
  return {
    rows: checked.filter((group) => group.lead.saved || kept.has(group)),
    more: Math.max(0, rest.length - size),
  };
}

/** The ranking result in three numbers: keywords with a position read, found in the results, on the first page. */
export function keywordSummary(groups: SeoKeywordGroup[]) {
  const read = groups.filter((group) => group.reads.length > 0);
  const found = read.filter((group) => group.best !== null);
  // Only a read that did not find the page says how deep it looked.
  const missed = read
    .flatMap((group) => group.reads)
    .filter((row) => row.positionStatus === "not_in_range");
  const depths = missed.flatMap((row) =>
    row.checkedResults === null ? [] : [row.checkedResults],
  );
  return {
    read: read.length,
    found: found.length,
    firstPage: found.filter((group) => (group.best ?? 0) <= SEO_FIRST_PAGE_RANK)
      .length,
    // What "Not found" means, said once for all rows. One read without a depth, and no number holds for all.
    depth:
      missed.length && depths.length === missed.length
        ? { min: Math.min(...depths), max: Math.max(...depths) }
        : null,
    // The newest read dates the result once, instead of once per row.
    newest:
      read
        .flatMap((group) => group.reads)
        .filter((row) => row.observedAt !== null)
        .toSorted(
          (left, right) =>
            new Date(left.observedAt ?? 0).getTime() -
            new Date(right.observedAt ?? 0).getTime(),
        )
        .at(-1) ?? null,
  };
}

/**
 * The position lines of one keyword: one line where every device reads the same, else one per device.
 * A null position means the page is not in the results the check read.
 */
export function keywordPositions(reads: Keyword[]) {
  const lines = reads.map((row) => ({
    device: row.device,
    position: row.positionStatus === "ranked" ? row.position : null,
  }));
  return lines.length > 1 &&
    (reads.every((row) => row.positionStatus === "not_in_range") ||
      lines.every(
        (item) => item.position !== null && item.position === lines[0].position,
      ))
    ? [{ ...lines[0], device: null }]
    : lines;
}
