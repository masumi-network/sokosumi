import type { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import type {
  SeoCrawlCheck,
  SeoCrawlItem,
  SeoCrawlKind,
  SeoCrawlRow,
  SeoCrawlStop,
} from "./seo-site-crawl-model";

export type SeoCrawlT = ReturnType<
  typeof useSeoResultTranslations<"App.Seo.siteCrawl">
>;
type Found = Extract<SeoCrawlRow, { state: "found" }>;

/** The SEO bot's stop and kind words hold dots and spaces, which a message key cannot. */
export const STOP_KEY = {
  complete: "complete",
  "page cap": "pageCap",
  "depth cap": "depthCap",
  "template cap": "templateCap",
  "link cap": "linkCap",
  time: "time",
  "rate limited": "rateLimited",
  "robots.txt": "robots",
  "fetch failed": "fetchFailed",
} as const satisfies Record<SeoCrawlStop, string>;
export const KIND_KEY = {
  javascript: "javascript",
  loop: "loop",
  "too many hops": "tooManyHops",
  "target not 2xx": "targetNot2xx",
  "other host": "otherHost",
  conflicting: "conflicting",
  "changed in render": "changedInRender",
  "removed in render": "removedInRender",
  unreadable: "unreadable",
} as const satisfies Record<SeoCrawlKind, string>;

/** What the count of an entry, and the count a check left out, are counts of. */
export const COUNT_KEY = {
  brokenLinks: "linkingPages",
  redirectChains: "linkingPages",
  duplicateTitles: "pages",
  javascript: "shellPages",
  noindexInSitemap: "pages",
  badCanonicals: "pages",
  missingTitle: "pages",
  missingH1: "pages",
  orphans: "pages",
} as const satisfies Record<SeoCrawlCheck, string>;
export const LEFT_KEY = {
  brokenLinks: "links",
  redirectChains: "links",
  duplicateTitles: "compared",
  javascript: "seen",
  noindexInSitemap: "sitemapUrls",
  badCanonicals: "canonicals",
  missingTitle: "pages",
  missingH1: "pages",
  orphans: "pages",
} as const satisfies Record<SeoCrawlCheck, string>;

/** The SEO bot writes its reasons as clauses: shown alone, each reads as a sentence. */
export function sentence(text: string) {
  const trimmed = text.trim();
  const start = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(start) ? start : `${start}.`;
}

/** The facts of an entry, in the words the view shows beside it. */
export function itemFacts(
  item: SeoCrawlItem,
  check: SeoCrawlCheck,
  t: SeoCrawlT,
) {
  return [
    item.kind && t(`kind.${KIND_KEY[item.kind]}`),
    item.status != null && t("status", { status: item.status }),
    item.count !== undefined &&
      t(`count.${COUNT_KEY[check]}`, { count: item.count }),
  ].filter((fact): fact is string => Boolean(fact));
}

/** One entry with full URLs: an agent opens them, so no path stands for a page. */
function itemLines(item: SeoCrawlItem, check: SeoCrawlCheck, t: SeoCrawlT) {
  const urls = item.urls ?? [];
  const label = item.url ? item.label : `"${item.label}"`;
  const head =
    check === "redirectChains"
      ? [label, ...urls].join(" → ")
      : check === "badCanonicals" && urls[0]
        ? `${label} → ${urls[0]}`
        : label;
  const facts = itemFacts(item, check, t);
  const lines = [`- ${head}${facts.length ? ` (${facts.join(", ")})` : ""}`];
  if (check !== "redirectChains" && check !== "badCanonicals" && urls.length)
    lines.push(
      `  ${check === "brokenLinks" ? `${t("from")}: ` : ""}${urls.join(", ")}`,
    );
  return lines;
}

/**
 * A found check as plain text for a coding agent: what to change, each listed entry, and what the crawl did not
 * list or judge, so the agent does not take the list for the whole site.
 */
export function seoCrawlInstructions(
  row: Found,
  stop: SeoCrawlStop,
  t: SeoCrawlT,
) {
  return [
    t("copy.lead"),
    `${t(`checks.${row.check}`)}: ${row.total}`,
    t(`copy.fix.${row.check}`),
    row.items.flatMap((item) => itemLines(item, row.check, t)).join("\n"),
    row.total > row.items.length &&
      t("listed", { listed: row.items.length, total: row.total }),
    row.notDetermined > 0 &&
      t(`left.${LEFT_KEY[row.check]}`, { count: row.notDetermined }),
    row.candidates && t("candidates"),
    row.reasons.length > 0 && row.reasons.map(sentence).join(" "),
    // The view says where the crawl stopped in its header; a pasted finding has no header.
    stop !== "complete" &&
      t("copy.partial", { stop: t(`stop.${STOP_KEY[stop]}`) }),
  ]
    .filter(Boolean)
    .join("\n\n");
}
