import { getEnv } from "@/config/env";
import { nonEmptyText, squash } from "@/lib/competitors/text";

const ADS_ARCHIVE_URL = "https://graph.facebook.com/v27.0/ads_archive";
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
const BODY_CHARS = 500;

/**
 * Where an ad must have been shown for the Ad Library to list it whatever
 * its topic: the EU's member states.
 */
const EU_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

const FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_snapshot_url",
  "publisher_platforms",
  "eu_total_reach",
] as const;

/** No `META_AD_LIBRARY_ACCESS_TOKEN`: nothing can be read yet. */
export class MetaAdLibraryNotConfiguredError extends Error {}
/** Meta answered with an error; `status` is its HTTP status. */
export class MetaAdLibraryError extends Error {
  constructor(readonly status: number) {
    super(`Meta Ad Library request failed (${status})`);
  }
}

/** A type alias: it is stored in `competitor_signal.raw`. */
export type MetaAd = {
  id: string;
  pageId: string;
  pageName: string;
  startedAt: string | null;
  stoppedAt: string | null;
  /** The ad's text as it ran, clipped. */
  body: string | null;
  title: string | null;
  platforms: string[];
  euReach: number | null;
};

export function metaAdLibraryConfigured(): boolean {
  return Boolean(getEnv().META_AD_LIBRARY_ACCESS_TOKEN);
}

function first(value: unknown): string | null {
  return Array.isArray(value) ? nonEmptyText(value[0]) : null;
}

/** The Ad Library's own page for one advertiser, for people to open. */
export function metaAdLibraryPageUrl(pageId: string): string {
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`;
}

/**
 * Ads a company started running in the EU on or after `since`, from Meta's
 * Ad Library API. The search is by words, so only ads from a Facebook Page
 * named like the company (or its Page handle) are kept.
 */
export async function searchMetaAds(input: {
  name: string;
  facebookHandle: string | null;
  since: Date;
}): Promise<MetaAd[]> {
  const token = getEnv().META_AD_LIBRARY_ACCESS_TOKEN;
  if (!token) throw new MetaAdLibraryNotConfiguredError();
  const url = new URL(ADS_ARCHIVE_URL);
  url.search = new URLSearchParams({
    search_terms: input.name.slice(0, 100),
    ad_reached_countries: JSON.stringify(EU_COUNTRIES),
    ad_active_status: "ALL",
    ad_type: "ALL",
    ad_delivery_date_min: input.since.toISOString().slice(0, 10),
    fields: FIELDS.join(","),
    limit: String(PAGE_SIZE),
  }).toString();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new MetaAdLibraryError(response.status);
  const data = (await response.json()) as { data?: Record<string, unknown>[] };
  const names = new Set(
    [input.name, input.facebookHandle ?? ""].map(squash).filter(Boolean),
  );
  return (data.data ?? []).flatMap((ad) => {
    const id = nonEmptyText(ad.id);
    const pageId = nonEmptyText(ad.page_id);
    const pageName = nonEmptyText(ad.page_name);
    if (!id || !pageId || !pageName || !names.has(squash(pageName))) return [];
    return [
      {
        id,
        pageId,
        pageName,
        startedAt: nonEmptyText(ad.ad_delivery_start_time),
        stoppedAt: nonEmptyText(ad.ad_delivery_stop_time),
        body: first(ad.ad_creative_bodies)?.slice(0, BODY_CHARS) ?? null,
        title: first(ad.ad_creative_link_titles),
        platforms: Array.isArray(ad.publisher_platforms)
          ? ad.publisher_platforms.flatMap(
              (platform) => nonEmptyText(platform) ?? [],
            )
          : [],
        euReach:
          typeof ad.eu_total_reach === "number" ? ad.eu_total_reach : null,
      },
    ];
  });
}
