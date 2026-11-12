import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoFoldCount } from "./seo-list-model";
import { normalizeQuery } from "./seo-search-model";

type Keyword = ProjectSeoWorkspace["keywords"][number];

/** A rank up to this one is on the first results page. */
export const SEO_FIRST_PAGE_RANK = 10;

const DEVICE_ORDER: Record<string, number> = { mobile: 0, desktop: 1 };

/** Why a check lists a keyword it read no position for. Every other source is a keyword the check read or set out to read. */
export const SEO_IDEA_SOURCES = ["gap", "opportunity"] as const;

/** The order of the estimate in the Ideas list. A keyword without an estimate shares the place of "low": not judged is not worse than low. */
const CONVERSION_ORDER = { high: 0, medium: 1, low: 2 } as const;

export type SeoKeywordGroup = {
  /** Carries the row actions and the Search Console fallback: the tracked row of the group, else its first read. */
  lead: Keyword;
  /** One position read per device, mobile first; a read without a device stands alone. Empty for an idea. */
  reads: Keyword[];
  volume: number | null;
  /** The best rank over the reads; null where the page is in none of the read results. */
  best: number | null;
  /** Why the check lists the keyword, for an idea ("gap", "opportunity"). */
  sources: string[];
  /** The newest estimate a check gave of how likely a searcher takes the page's action; null without one. */
  conversion: Keyword["conversion"];
  /** The product feature the keyword is about, in the words of the check. */
  feature: string | null;
  /** The newest keyword difficulty (0 to 100) a check gave; null without one. */
  difficulty: number | null;
  /** Estimated monthly clicks now (at the best rank read) and at places 10, 3 and 1; null without a volume. */
  clicks: Keyword["clicks"];
};

/**
 * A keyword the reader chose to track. The keywords of a check are tracked from the start, with no
 * stored choice (version 0): they are the list, so they lead nothing, the cut applies to them, and
 * they never fill a paid check by themselves.
 */
export const seoKeywordOwn = (row: Pick<Keyword, "saved" | "version">) =>
  row.saved && row.version > 0;
const chosen = (group: SeoKeywordGroup) => seoKeywordOwn(group.lead);

/**
 * A check reports one keyword once per device, and again as a competitor gap or an idea.
 * The lists show it once: "checked" holds tracked keywords and the keywords a check set out to read,
 * "ideas" the keywords a check only lists as a competitor gap or an opportunity.
 * Ideas with a high or medium conversion estimate lead their list.
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
    const best = ranks.length ? Math.min(...ranks) : null;
    // Rows come newest first: the first estimate is the newest. Its feature goes with it,
    // so a level never stands over the feature of another check.
    const estimated = group.find((row) => row.conversion !== null);
    return {
      // The tracked row carries the saved choice the row actions change.
      lead: group.find((row) => row.saved) ?? reads[0] ?? group[0],
      reads,
      volume: group.find((row) => row.volume !== null)?.volume ?? null,
      best,
      sources: [...new Set(group.map((row) => row.source))],
      conversion: estimated?.conversion ?? null,
      feature: estimated?.feature ?? null,
      difficulty:
        group.find((row) => row.difficulty !== null)?.difficulty ?? null,
      // The estimate now goes with the best rank, as the list shows it; a row of another rank would claim
      // a gain the keyword does not have.
      clicks:
        group.find((row) => row.position === best && row.clicks)?.clicks ??
        null,
    };
  });
  // The reader's own choices first, so a keyword the reader just tracked never hides behind "Show more".
  // A keyword the reader stopped tracking goes last. Between them the best rank, then the most searched:
  // the keywords nearest to visitors lead.
  const byReach = (left: SeoKeywordGroup, right: SeoKeywordGroup) =>
    Number(chosen(right)) - Number(chosen(left)) ||
    Number(right.lead.saved) - Number(left.lead.saved) ||
    (left.best ?? Number.POSITIVE_INFINITY) -
      (right.best ?? Number.POSITIVE_INFINITY) ||
    (right.volume ?? -1) - (left.volume ?? -1);
  // An idea has no rank to order by. A high or medium estimate says which searches bring visitors
  // who act, so it leads; the other ideas follow, the most searched first.
  const estimate = (group: SeoKeywordGroup) =>
    CONVERSION_ORDER[group.conversion ?? "low"];
  const byConversion = (left: SeoKeywordGroup, right: SeoKeywordGroup) =>
    estimate(left) - estimate(right) || byReach(left, right);
  // A focus keyword whose read failed is still a keyword of the check, not an idea.
  const checked = (group: SeoKeywordGroup) =>
    group.reads.length > 0 ||
    group.lead.saved ||
    group.sources.some(
      (source) => !SEO_IDEA_SOURCES.some((idea) => idea === source),
    );
  return {
    checked: groups.filter(checked).toSorted(byReach),
    ideas: groups.filter((group) => !checked(group)).toSorted(byConversion),
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
 * The first rows of the checked list: every keyword with a stored choice of the reader, then the first "size" of
 * the others. The cut never hides a choice of the reader: not a tracked keyword, and not a keyword the reader
 * stopped tracking, whose "Track" is the way back. Choices without a read never push every read out of view.
 */
export function keywordPage(checked: SeoKeywordGroup[], size: number) {
  const decided = (group: SeoKeywordGroup) => group.lead.version > 0;
  const rest = checked.filter((group) => !decided(group));
  const cut = seoFoldCount(rest.length, size);
  const kept = new Set(rest.slice(0, cut));
  return {
    rows: checked.filter((group) => decided(group) || kept.has(group)),
    more: rest.length - cut,
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
  // A keyword shows the reads of its newest check only, so these are the dates the rows stand for.
  const dated = read
    .flatMap((group) => group.reads)
    .filter((row) => row.observedAt !== null)
    .toSorted(
      (left, right) =>
        new Date(left.observedAt ?? 0).getTime() -
        new Date(right.observedAt ?? 0).getTime(),
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
    newest: dated.at(-1) ?? null,
    // With the newest, the oldest read says the days the rows come from.
    oldest: dated.at(0) ?? null,
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
