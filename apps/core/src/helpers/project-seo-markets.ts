import { z } from "@hono/zod-openapi";
import {
  SEO_MARKET_HOSTS_MAX,
  seoMarketHost,
  seoMarketNote,
  seoMarkets,
} from "@/schemas/project-seo-markets.schema";

import { seoAuditFinalUrls, seoUrlSchema } from "@/schemas/seo-page.schema";
import { reportObject } from "./project-seo-public-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";

const marketPage = z.object({
  request: z.object({ url: seoUrlSchema }),
  header: z.object({ finalUrl: seoAuditFinalUrls }),
});
const sourceHost = seoMarketHost
  .omit({ unavailable: true })
  .extend({ note: z.string().nullable() })
  .transform(({ note, ...host }) => ({
    ...host,
    unavailable: note !== null || host.etv === null,
  }));
const sourceMarkets = seoMarkets.extend({
  hosts: z.array(sourceHost).min(2).max(SEO_MARKET_HOSTS_MAX),
});
const competitors = z.object({
  competitors: z.array(z.object({ product: z.boolean() })).max(100),
});
const normalizedHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
// The worker uses the start page's desktop redirect first, then mobile, and keeps the submitted host for its subdomains.
function marketHostForStart(startUrl: string, pages: readonly unknown[]) {
  const matches = pages.flatMap((raw) => {
    const record = reportObject(raw);
    if (record?.kind === "site" || record?.schema === "sokosumi.seo-result/1")
      return [];
    const page = marketPage.safeParse(raw);
    return page.success && auditedSeoPageKey(page.data.request.url) === startUrl
      ? [page.data]
      : [];
  });
  if (matches.length !== 1) return null;
  const finals = matches[0].header.finalUrl;
  const asked = normalizedHost(new URL(startUrl).hostname);
  const final = normalizedHost(
    new URL(finals?.desktop ?? finals?.mobile ?? startUrl).hostname,
  );
  return final.endsWith(`.${asked}`) ? asked : final;
}
function publicReason(note: string): z.infer<typeof seoMarketNote> {
  if (
    note ===
    "a local business serves its own area, so no other country was read"
  )
    return "local_business";
  if (note === "the start page's Run found no Market")
    return "missing_baseline";
  if (
    note ===
    "The audit did not verify an independent direct business competitor for the market comparison."
  )
    return "unverified_competitors";
  if (
    note ===
    "The audit could not read the site strategy evidence needed for the market comparison."
  )
    return "strategy_unavailable";
  if (note.startsWith("the market step failed:")) return "read_error";
  if (note.startsWith("the time limit of ")) return "time_limit";
  if (note.startsWith("the USD limit of ")) return "budget_limit";
  return "unavailable";
}

export function publicSeoMarkets(
  source: { markets?: unknown; marketNote?: unknown; business?: unknown },
  startUrl: string | undefined,
  pages: readonly unknown[],
) {
  if (!startUrl) return {};
  if (source.markets != null) {
    const result = sourceMarkets.safeParse(source.markets);
    if (!result.success) return {};
    const markets = result.data;
    const site = markets.hosts.filter((h) => h.role === "site");
    const startHost = marketHostForStart(startUrl, pages);
    if (
      !startHost ||
      site.length !== 1 ||
      normalizedHost(site[0].host) !== startHost
    )
      return {};
    const productHosts = markets.hosts
      .filter((host) => host.role === "product")
      .map((host) => normalizedHost(host.host));
    if (
      new Set(productHosts).size !== productHosts.length ||
      productHosts.some(
        (host) =>
          host === startHost ||
          host.endsWith(`.${startHost}`) ||
          startHost.endsWith(`.${host}`),
      )
    )
      return {};
    if (
      markets.rows.some(
        (row) =>
          row.rivals > row.of ||
          row.of > markets.hosts.length - 1 ||
          (row.candidate &&
            (row.start ||
              row.regionVersion !== null ||
              row.ownShare === null ||
              !markets.siteVisits)),
      )
    )
      return {};
    return { markets };
  }
  if (typeof source.marketNote === "string" && source.marketNote.trim())
    return { marketNote: publicReason(source.marketNote) };
  const business = competitors.safeParse(source.business);
  if (business.success && business.data.competitors.every((c) => !c.product))
    return { marketNote: seoMarketNote.enum.unverified_competitors };
  return {};
}
