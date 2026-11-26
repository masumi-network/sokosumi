import {
  type PageSpeedRows,
  seoPageSpeedRow,
} from "@/schemas/seo-page-speed.schema";
import {
  SITE_SPEED_CAUSES,
  SITE_SPEED_GROUP_CHARS,
  SITE_SPEED_ROWS,
  SITE_SPEED_TIERS,
  SITE_SPEED_WHY_CHARS,
  type StoredSiteSpeed,
  siteSpeedCheck,
  siteSpeedMixPeriod,
  storedSiteSpeed,
  storedSiteSpeedRow,
} from "@/schemas/seo-site-speed.schema";
import { reportObject } from "./project-seo-public-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import {
  publicLanding,
  readableStoredMeasurement,
  readPageSpeed,
} from "./seo-page-speed";
import {
  publicSpeedText,
  publicSpeedUrl,
  SPEED_DEVICES,
  speedPageUrl,
  speedRowDevices,
} from "./seo-speed-guards";

/** The worker gives its reason as a sentence. Core keeps a code. */
function gapCode(reason: unknown) {
  const text = typeof reason === "string" ? reason : "";
  if (/rate limit|quota/i.test(text)) return "quota" as const;
  if (/time/i.test(text)) return "deadline" as const;
  return "other" as const;
}

type SiteSpeedCheck = NonNullable<StoredSiteSpeed["rows"][number]["check"]>;
/** The slack of a share sum: CrUX rounds each share. The worker allows the same, plus float error. */
const SITE_SPEED_MIX_SLACK = 0.01 + 1e-9;
/**
 * A device mix the check cannot show: shares that do not add up to all visits, a level that is not the one
 * its basis names (a basis without a level has no mix), or a device the shares do not pick. The worker picks
 * desktop only when more visitors use it than a phone. The check stays and shows no mix.
 */
function contradicts(
  { basis, device }: SiteSpeedCheck,
  mix: NonNullable<SiteSpeedCheck["mix"]>,
) {
  const level =
    basis === "crux-url" ? "url" : basis === "crux-origin" ? "origin" : null;
  if (mix.level !== level) return true;
  if (mix.desktop > mix.phone !== (device === "desktop")) return true;
  return (
    Math.abs(mix.phone + mix.desktop + mix.tablet - 1) > SITE_SPEED_MIX_SLACK
  );
}

/** A mix period of calendar days whose first day is not after its last; else null, and the shares stay. */
function readPeriod(value: unknown) {
  const period = siteSpeedMixPeriod.safeParse(value);
  return period.success && period.data.first <= period.data.last
    ? period.data
    : null;
}

/**
 * How a reduced row was read. The worker gives `notChecked` as a sentence, a stored check holds the code.
 * A mix period that is no calendar period, or ends before it starts, goes; the shares stay.
 */
function readCheck(value: unknown, stored = false) {
  const raw = reportObject(value);
  const mix = reportObject(raw?.mix);
  const check = siteSpeedCheck.safeParse({
    ...raw,
    ...(mix && {
      mix: {
        ...mix,
        period: readPeriod(mix.period),
      },
    }),
    notChecked: stored
      ? raw?.notChecked
      : raw?.notChecked == null
        ? null
        : gapCode(raw.notChecked),
  });
  if (!check.success) return undefined;
  const { data } = check;
  return data.mix && contradicts(data, data.mix)
    ? { ...data, mix: null }
    : data;
}

/** The values the web verdict reads (seoDeviceVerdict): a field with one Core Web Vital, a lab with LCP or CLS. */
const VERDICT_FIELD = ["lcp", "inp", "cls"] as const;
const VERDICT_LAB = ["lcp", "cls"] as const;
/** Google's good limits at the 75th percentile, as the web verdict reads them (SEO_VITAL_LIMITS). */
const VERDICT_GOOD = { lcp: 2500, inp: 200, cls: 0.1 } as const;

/**
 * How much of a verdict a measurement gives, as the web verdict reads it: the field decides when it holds a Core Web
 * Vital, else the lab. A read whose values give a verdict (one over its good limit, or LCP and CLS) ranks first, then
 * a field read before a lab read. A gap or a read without those values shows nothing, so it never hides a read of
 * the same page and device that shows more (review pass 25).
 */
function speedEvidence({ field, lab }: PageSpeedRows[number]) {
  const visitors =
    field.status === "measured" &&
    VERDICT_FIELD.some((metric) => field.p75[metric] != null)
      ? field.p75
      : null;
  const test =
    !visitors &&
    lab.status === "measured" &&
    VERDICT_LAB.some((metric) => lab.median[metric] != null)
      ? lab.median
      : null;
  const values: Partial<Record<keyof typeof VERDICT_GOOD, number | null>> =
    visitors ?? test ?? {};
  if (!visitors && !test) return 0;
  const decided =
    (visitors ? VERDICT_FIELD : VERDICT_LAB).some(
      (metric) => (values[metric] ?? 0) > VERDICT_GOOD[metric],
    ) ||
    (values.lcp != null && values.cls != null);
  return (decided ? 2 : 0) + (visitors ? 2 : 1);
}

/**
 * The URL template of a row: a path, and public text. The worker writes "#" for a number segment. The text
 * guard reads "#" as a URL fragment, so it reads the template with a digit in that segment.
 */
function publicGroup(value: unknown) {
  if (typeof value !== "string") return undefined;
  const group = value.trim();
  const read = group
    .split("/")
    .map((segment) => (segment === "#" ? "0" : segment))
    .join("/");
  return publicSpeedText(read, SITE_SPEED_GROUP_CHARS) &&
    /^\/[^\s?#]*$/.test(read)
    ? group
    : undefined;
}

function readNotChecked(value: unknown): StoredSiteSpeed["notChecked"] {
  const raw = reportObject(value);
  if (!raw || !Number.isSafeInteger(raw.count) || Number(raw.count) < 0)
    return undefined;
  // A reason that is no string has no code: String() can throw on it.
  const text = typeof raw.reason === "string" ? raw.reason : "";
  const code = gapCode(text);
  return {
    count: Number(raw.count),
    reason: code === "other" && /limit|up to/i.test(text) ? "limit" : code,
  };
}

/**
 * A site Report's speed table. It names pages outside the audit's frozen scope, so each one is bound to the
 * start page's host. A row Core cannot trust is dropped and counted: this never fails the import. The worker's
 * `source`, `clicks`, `n`, `note` and the names of pages it left out are not read, so no Search Console value reaches the stored audit as a field.
 * A row's `why` is the worker's free text: only the public text guard reads it.
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
  const pages = new Set(pageUrls.map(auditedSeoPageKey));
  const audited = new Set([
    ...pages,
    ...pageSpeed
      .flatMap((row) => [row.pageUrl, row.testedUrl])
      .map(auditedSeoPageKey),
  ]);
  const seen = new Set<string>();
  const rows: StoredSiteSpeed["rows"] = [];
  for (const item of speed.pages.slice(0, SITE_SPEED_ROWS)) {
    const row = reportObject(item);
    const url = speedPageUrl(row?.url);
    // A public exploration URL has no hash, so it is its own page key.
    if (
      !row ||
      !publicSpeedUrl(url) ||
      seen.has(url) ||
      (!audited.has(url) && !publicLanding(start, url))
    )
      continue;
    const tier = SITE_SPEED_TIERS.find((value) => value === row.tier);
    const cause = SITE_SPEED_CAUSES.find((value) => value === row.cause);
    const group = publicGroup(row.group);
    const why = publicSpeedText(row.why, SITE_SPEED_WHY_CHARS);
    const check = tier === "reduced" ? readCheck(row.check) : undefined;
    try {
      // The worker fills the other device of a reduced test with a placeholder. Only the row's own devices are read.
      // An audited page keeps a device the audit did not measure for it (a redirect on one device only, an audit
      // without that device), or measured with less evidence, as the stored view picks it.
      const devices = readPageSpeed(
        row.speed,
        url,
        undefined,
        speedRowDevices(tier, check),
      ).filter(
        (own) =>
          !audited.has(url) ||
          !pageSpeed.some(
            (measured) =>
              measured.device === own.device &&
              speedEvidence(measured) >= speedEvidence(own) &&
              [measured.pageUrl, measured.testedUrl]
                .map(auditedSeoPageKey)
                .includes(url),
          ),
      );
      // One row the stored table cannot hold must not cost the other rows.
      const stored = storedSiteSpeedRow.safeParse({
        url,
        audited: audited.has(url),
        ...(group && { group }),
        ...(cause && { cause }),
        ...(why && { why }),
        ...(tier && { tier }),
        ...(check && { check }),
        devices,
      });
      // An unreadable row does not take the URL from a later, readable row.
      if (stored.success) {
        rows.push(stored.data);
        seen.add(url);
      }
    } catch {
      // An unreadable speed section drops its row.
    }
  }
  return {
    rows,
    dropped: speed.pages.length - rows.length,
    notChecked: readNotChecked(speed.notChecked),
  };
}

/**
 * A stored table before the schema reads it. Each row is read alone with the guards and the limits of a
 * fresh import: a row Core cannot read, a repeated page and a row past the cap are dropped and counted once;
 * unsafe text goes and the row stays. A measurement is read alone too: one that Core cannot read goes, the
 * row and its other device stay.
 */
export function readableStoredSiteSpeed(value: unknown) {
  const table = reportObject(value);
  if (!table || !Array.isArray(table.rows)) return value;
  const seen = new Set<string>();
  const rows: StoredSiteSpeed["rows"] = [];
  for (const item of table.rows.slice(0, SITE_SPEED_ROWS)) {
    const row = reportObject(item);
    // The home page without its root slash is the home page, as on a fresh import.
    const url = speedPageUrl(row?.url);
    if (!row || !publicSpeedUrl(url) || seen.has(url)) continue;
    const {
      check: _check,
      why: _why,
      group: _group,
      cause: _cause,
      tier: _tier,
      ...rest
    } = row;
    // A tier or a cause Core does not know goes, the row stays.
    const tier = SITE_SPEED_TIERS.find((value) => value === row.tier);
    const cause = SITE_SPEED_CAUSES.find((value) => value === row.cause);
    const check = tier === "reduced" ? readCheck(row.check, true) : undefined;
    const group = publicGroup(row.group);
    const why = publicSpeedText(row.why, SITE_SPEED_WHY_CHARS);
    // The devices of the row's tier come first: a measurement the row cannot show is not read.
    // Then the first readable measurement of each device: a repeated device is no second result.
    // A measurement of another page is no result of this row.
    const allowed: readonly unknown[] = speedRowDevices(tier, check);
    const taken = new Set<unknown>();
    const devices = (Array.isArray(row.devices) ? row.devices : [])
      .filter((device) => {
        const measured = reportObject(device);
        return (
          allowed.includes(measured?.device) &&
          speedPageUrl(measured?.pageUrl) === url &&
          speedPageUrl(measured?.testedUrl) === url
        );
      })
      .flatMap(readableStoredMeasurement)
      .filter((device) => seoPageSpeedRow.safeParse(device).success)
      .filter((device) => {
        const name = reportObject(device)?.device;
        return !taken.has(name) && !!taken.add(name);
      });
    const stored = storedSiteSpeedRow.safeParse({
      ...rest,
      url,
      ...(group && { group }),
      ...(cause && { cause }),
      ...(why && { why }),
      ...(tier && { tier }),
      ...(check && { check }),
      devices,
    });
    // An unreadable row does not take the URL from a later, readable row.
    if (stored.success) {
      rows.push(stored.data);
      seen.add(url);
    }
  }
  // A summary Core cannot read goes, the rows stay.
  const { notChecked: _notChecked, ...rest } = table;
  const notChecked = storedSiteSpeed.shape.notChecked.safeParse(
    table.notChecked,
  );
  return {
    ...rest,
    ...(notChecked.success &&
      notChecked.data && { notChecked: notChecked.data }),
    rows,
    // A count the schema refuses stays as it is: the schema refuses the table.
    dropped:
      Number.isSafeInteger(table.dropped) && Number(table.dropped) >= 0
        ? Number(table.dropped) + table.rows.length - rows.length
        : table.dropped,
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
  // Only a measurement of an audited page counts: its tested URL is that page's redirect target.
  const own = new Set(data.pageUrls.map(auditedSeoPageKey));
  const speed = (data.pageSpeed ?? []).filter((row) =>
    own.has(auditedSeoPageKey(row.pageUrl)),
  );
  // A stored row is bound to the audit as a fresh import binds it: an audited page, or the start page's host.
  const start = URL.parse(data.pageUrls[0] ?? "");
  const audited = new Set(
    [
      ...data.pageUrls,
      ...speed.flatMap((row) => [row.pageUrl, row.testedUrl]),
    ].map(auditedSeoPageKey),
  );
  const rows = data.siteSpeed.rows.filter(
    (item) =>
      audited.has(item.url) || (!!start && publicLanding(start, item.url)),
  );
  return {
    ...data.siteSpeed,
    observationId: row.id,
    observedAt: row.observedAt.toISOString(),
    dropped: data.siteSpeed.dropped + data.siteSpeed.rows.length - rows.length,
    rows: rows.map((item) => {
      const allowed = speedRowDevices(item.tier, item.check);
      if (!item.audited)
        return {
          ...item,
          devices: item.devices.filter((row) => allowed.includes(row.device)),
        };
      // One measurement per device, the one that shows the most (`speedEvidence`), as the import kept it. On a tie:
      // the page's own, else the one of a page that redirects to it (in the audit's order), else the report's own.
      return {
        ...item,
        devices: SPEED_DEVICES.flatMap((device) => {
          if (!allowed.includes(device)) return [];
          const on = (key: "pageUrl" | "testedUrl") =>
            speed.filter(
              (row) =>
                row.device === device &&
                auditedSeoPageKey(row[key]) === item.url,
            );
          const found = [
            ...on("pageUrl"),
            ...on("testedUrl"),
            ...item.devices.filter((row) => row.device === device),
          ];
          return (
            found.reduce<(typeof found)[number] | undefined>(
              (best, row) =>
                best && speedEvidence(best) >= speedEvidence(row) ? best : row,
              undefined,
            ) ?? []
          );
        }),
      };
    }),
  };
}
