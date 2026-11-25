import { publicExplorationText, publicExplorationUrl } from "@sokosumi/utils";
import type { PageSpeedRows } from "@/schemas/seo-page-speed.schema";
import {
  SITE_SPEED_CAUSES,
  SITE_SPEED_GROUP_CHARS,
  SITE_SPEED_ROWS,
  SITE_SPEED_TIERS,
  SITE_SPEED_WHY_CHARS,
  type StoredSiteSpeed,
} from "@/schemas/seo-site-speed.schema";
import { reportObject } from "./project-seo-public-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import { publicLanding, readPageSpeed } from "./seo-page-speed";

function publicText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max && publicExplorationText(text)
    ? text
    : undefined;
}

/**
 * A site Report's speed table. It names pages outside the audit's frozen scope, so each one is bound to the
 * start page's host. A row Core cannot trust is dropped and counted: this never fails the import. The worker's
 * `source`, `clicks`, `n` and `note` are not read, so no Search Console fact reaches the stored audit.
 */
export function readSiteSpeed(
  raw: unknown,
  pageUrls: string[],
  pageSpeed: PageSpeedRows,
): StoredSiteSpeed | undefined {
  const speed = reportObject(reportObject(raw)?.speed);
  if (!speed || !Array.isArray(speed.pages) || !URL.canParse(pageUrls[0] ?? ""))
    return undefined;
  const start = new URL(pageUrls[0]!);
  const audited = new Set(
    [
      ...pageUrls,
      ...pageSpeed.flatMap((row) => [row.pageUrl, row.testedUrl]),
    ].map(auditedSeoPageKey),
  );
  const seen = new Set<string>();
  const rows: StoredSiteSpeed["rows"] = [];
  for (const item of speed.pages.slice(0, SITE_SPEED_ROWS)) {
    const row = reportObject(item);
    const url = row?.url;
    // A public exploration URL has no hash, so it is its own page key.
    if (
      !row ||
      typeof url !== "string" ||
      !publicExplorationUrl(url) ||
      seen.has(url) ||
      (!audited.has(url) && !publicLanding(start, url))
    )
      continue;
    seen.add(url);
    const tier = SITE_SPEED_TIERS.find((value) => value === row.tier);
    const cause = SITE_SPEED_CAUSES.find((value) => value === row.cause);
    const group = publicText(row.group, SITE_SPEED_GROUP_CHARS);
    const why = publicText(row.why, SITE_SPEED_WHY_CHARS);
    try {
      rows.push({
        url,
        audited: audited.has(url),
        ...(group && /^\/[^\s?#]*$/.test(group) && { group }),
        ...(cause && { cause }),
        ...(why && { why }),
        ...(tier && { tier }),
        devices:
          audited.has(url) || tier === "none"
            ? []
            : readPageSpeed(row.speed, url),
      });
    } catch {
      // An unreadable speed section drops its row.
    }
  }
  return {
    rows,
    dropped: speed.pages.length - rows.length,
  };
}

/** The stored table for a view: only when the view holds every page of the audit. Audited rows get their devices here. */
export function scopedSiteSpeed(
  data: {
    siteSpeed?: StoredSiteSpeed;
    pageSpeed?: PageSpeedRows;
    pageUrls: string[];
  },
  row: { id: string; observedAt: Date },
  selected: ReadonlySet<string>,
) {
  if (
    !data.siteSpeed ||
    !data.pageUrls.every((url) => selected.has(auditedSeoPageKey(url)))
  )
    return null;
  const speed = data.pageSpeed ?? [];
  const on = (key: "pageUrl" | "testedUrl", url: string) =>
    speed.filter((item) => auditedSeoPageKey(item[key]) === url);
  return {
    ...data.siteSpeed,
    observationId: row.id,
    observedAt: row.observedAt.toISOString(),
    rows: data.siteSpeed.rows.map((item) => {
      if (!item.audited) return item;
      const own = on("pageUrl", item.url);
      return {
        ...item,
        devices: (own.length ? own : on("testedUrl", item.url)).slice(0, 2),
      };
    }),
  };
}
