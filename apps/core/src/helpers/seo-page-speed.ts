import { z } from "@hono/zod-openapi";
import { publicExplorationUrl } from "@sokosumi/utils";
import {
  fieldTimings,
  labTimings,
  lighthouseScores,
  type PageSpeedRows,
  SPEED_HISTORY_STATUSES,
  SPEED_HISTORY_WEEKS,
  type SpeedHistory,
  seoPageSpeedRow,
  speedHistory,
  speedInsight,
  speedValue,
} from "@/schemas/seo-page-speed.schema";
import { reportObject } from "./project-seo-public-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import {
  publicSpeedInsight,
  publicSpeedUrl,
  SPEED_DEVICES,
  type SpeedDevice,
  speedFieldUrl,
  speedLighthouseVersion,
  speedPageUrl,
} from "./seo-speed-guards";

const fieldResult = z.object({
  level: z.enum(["url", "origin"]),
  url: z.string().url(),
  p75: fieldTimings,
  period: z
    .object({ first: z.string().date(), last: z.string().date() })
    .nullable(),
  identity: z
    .object({
      pageAssessment: z.string().nullable().optional(),
      populationScope: z.string().nullable().optional(),
      requestedUrl: z.string().nullable().optional(),
      returnedUrl: z.string().nullable().optional(),
      returnedDevice: z.string().nullable().optional(),
      normalization: z
        .object({
          originalUrl: z.string().nullable(),
          normalizedUrl: z.string().nullable(),
        })
        .nullish(),
    })
    .optional(),
});
const labResult = z
  .object({
    median: labTimings,
    runs: z.number().int().positive(),
    ok: z.number().int().positive(),
    lighthouse: z.unknown().transform(speedLighthouseVersion).default(null),
  })
  .refine((row) => row.ok <= row.runs);
function gap(raw: unknown, isField: boolean) {
  const row = reportObject(raw);
  const reason = typeof row?.none === "string" ? row.none.toLowerCase() : "";
  if (/request budget|call budget/.test(reason))
    return { status: "budget" as const };
  if (reason.includes("could not verify a public landing page"))
    return { status: "unsafe" as const };
  if (/quota|429|rate limit/.test(reason)) return { status: "quota" as const };
  if (/deadline|time budget|timeout|timed out/.test(reason))
    return { status: "deadline" as const };
  if (
    /not checked|was not collected|excluded|not enabled|not configured|no speed reads/.test(
      reason,
    ) ||
    !row
  )
    return { status: "not_checked" as const };
  if (
    isField &&
    Array.isArray(row?.sourceRefs) &&
    row.sourceRefs.some((ref) =>
      ["error", "wall"].includes(
        String(reportObject(reportObject(ref)?.outcome)?.kind),
      ),
    )
  )
    return { status: "unavailable" as const };
  if (
    isField &&
    row?.failed !== true &&
    (row?.noData === true || /no (?:crux |field |real.user )?data/.test(reason))
  )
    return { status: "no_data" as const };
  return { status: "unavailable" as const };
}
function successfulSource(raw: unknown) {
  const outcome = reportObject(reportObject(raw)?.outcome);
  return (
    outcome?.kind === "ok" &&
    typeof outcome.status === "number" &&
    outcome.status >= 200 &&
    outcome.status < 300
  );
}

/** The insights of one lab result that Core reads. The stored list holds no more. */
const SPEED_INSIGHTS = 20;
function details(raw: unknown) {
  const lab = reportObject(raw);
  const row = reportObject(lab?.pageSpeed);
  if (!row || !Array.isArray(lab?.sourceRefs)) return undefined;
  const record = row.sourceRecord;
  // Device, URL and port were checked for every ref before this function.
  if (
    typeof record !== "string" ||
    !/^[0-9a-f]{64}$/.test(record) ||
    !lab.sourceRefs.some(
      (item) => reportObject(item)?.record === record && successfulSource(item),
    )
  )
    return undefined;
  const scores = lighthouseScores.safeParse(row.scores);
  const measuredAt = z.string().datetime().safeParse(row.measuredAt);
  const insights = (
    Array.isArray(row.insights) ? row.insights.slice(0, SPEED_INSIGHTS) : []
  ).flatMap((value) => {
    const parsed = speedInsight.safeParse(value);
    // The guard reads the worker's insight: the parsed one has no group.
    return parsed.success && publicSpeedInsight(value) ? [parsed.data] : [];
  });
  return {
    scores: scores.success ? scores.data : {},
    insights,
    ...(measuredAt.success && { measuredAt: measuredAt.data }),
  };
}

export function publicLanding(start: URL, address: string) {
  if (!publicExplorationUrl(address)) return false;
  const url = new URL(address);
  return (
    (url.protocol === start.protocol ||
      (start.protocol === "http:" && url.protocol === "https:")) &&
    url.port === start.port &&
    (url.hostname === start.hostname ||
      url.hostname === "www." + start.hostname ||
      start.hostname === "www." + url.hostname)
  );
}

/** Bind retained samples to the measured URL and device. Older Reports can omit source references. */
function boundSource(
  raw: unknown,
  tested: string,
  device: string,
  port: "psi" | "crux",
  measured: boolean | "url" | "origin",
) {
  const row = reportObject(raw);
  if (row?.sourceRefs === undefined) return true;
  return (
    Array.isArray(row.sourceRefs) &&
    row.sourceRefs.length > 0 &&
    row.sourceRefs.length <= 3 &&
    row.sourceRefs.every((item) => {
      const ref = reportObject(item),
        request = reportObject(ref?.request);
      if (
        ref?.port !== port ||
        request?.port !== port ||
        request?.device !== device ||
        typeof request.url !== "string"
      )
        return false;
      const target =
        port === "crux" && reportObject(request.params)?.level === "origin"
          ? new URL(tested).origin
          : tested;
      return URL.parse(request.url)?.href === new URL(target).href;
    }) &&
    (!measured ||
      row.sourceRefs.some((item) => {
        if (!successfulSource(item)) return false;
        if (measured === true) return true;
        const params = reportObject(
          reportObject(reportObject(item)?.request)?.params,
        );
        return params?.kind === "record" && params.level === measured;
      }))
  );
}

function provenAggregate(
  field: z.infer<typeof fieldResult>,
  raw: unknown,
  tested: URL,
  device: string,
) {
  const identity = field.identity;
  return (
    identity?.populationScope === "normalized_url_aggregate" &&
    identity.pageAssessment === "not_determined" &&
    Array.isArray(reportObject(raw)?.sourceRefs) &&
    identity.returnedDevice === (device === "mobile" ? "PHONE" : "DESKTOP") &&
    URL.parse(identity.requestedUrl ?? "")?.href === tested.href &&
    URL.parse(identity.returnedUrl ?? "")?.href === new URL(field.url).href &&
    URL.parse(identity.normalization?.originalUrl ?? "")?.href ===
      tested.href &&
    URL.parse(identity.normalization?.normalizedUrl ?? "")?.href ===
      new URL(field.url).href &&
    new URL(field.url).origin === tested.origin
  );
}

const weeklyPoints = z
  // A calendar date: 2026-02-31 is none.
  .array(z.object({ last: z.string().date(), p75: speedValue }))
  .min(1);

/**
 * CrUX History of a measured field. The weekly series is kept only for a comparable population whose record is
 * a successful history read at the field's level; boundSource checked each ref's URL and device before this.
 */
function readHistory(
  raw: unknown,
  level: "url" | "origin",
): { history?: SpeedHistory } {
  const field = reportObject(raw),
    history = reportObject(field?.history),
    refs = field?.sourceRefs;
  const status = SPEED_HISTORY_STATUSES.find(
    (value) => value === history?.status,
  );
  if (!history || !status) return {};
  if (status !== "comparable") return { history: { status } };
  const series = reportObject(history.series);
  // No series is the worker's answer for a read that gave none. A series that is no object is not,
  // with or without source references.
  if (history.series != null && !series)
    return { history: { status: "unavailable" } };
  if (!Array.isArray(refs)) return { history: { status: "legacy_unverified" } };
  const record = history.sourceRecord;
  const bound =
    typeof record === "string" &&
    /^[0-9a-f]{64}$/.test(record) &&
    refs.some((item) => {
      const ref = reportObject(item),
        params = reportObject(reportObject(ref?.request)?.params);
      return (
        ref?.record === record &&
        successfulSource(item) &&
        params?.kind === "history" &&
        params.level === level
      );
    });
  const read: SpeedHistory = { status };
  let given = false;
  for (const key of ["lcp", "inp", "cls"] as const) {
    const value = series?.[key];
    given ||= Array.isArray(value) ? value.length > 0 : value != null;
    const points = weeklyPoints.safeParse(
      Array.isArray(value) ? value.slice(-SPEED_HISTORY_WEEKS) : null,
    );
    if (!bound || !points.success) continue;
    const weeks = points.data.map((point) => point.last);
    if (
      weeks.some(
        (day, i) =>
          Number.isNaN(Date.parse(day)) || (i > 0 && day <= weeks[i - 1]!),
      )
    )
      continue;
    read.weeks ??= weeks;
    // One list of weeks serves every metric: a metric with other weeks is left out.
    if (weeks.join() === read.weeks.join())
      read[key] = points.data.map((point) => point.p75);
  }
  // The worker writes no series when the history read gave none: a bound history is then still comparable.
  return {
    history: read.weeks || (bound && !given) ? read : { status: "unavailable" },
  };
}

export function readPageSpeed(
  raw: unknown,
  page: string,
  finals?: { mobile?: string | null; desktop?: string | null },
  /** Only these devices are read: a section of another device cannot cost the row. */
  devices: readonly SpeedDevice[] = SPEED_DEVICES,
): PageSpeedRows {
  const speed = reportObject(raw);
  const pageUrl = speedPageUrl(page);
  if (!speed || !publicSpeedUrl(pageUrl)) return [];
  const rows: PageSpeedRows = [];
  for (const device of devices) {
    const evidence = reportObject(speed[device]);
    const testedUrl = speedPageUrl(finals?.[device]) ?? pageUrl;
    if (
      !evidence ||
      !publicSpeedUrl(testedUrl) ||
      !publicLanding(new URL(pageUrl), testedUrl)
    )
      continue;
    const lab = labResult.safeParse(evidence.lab);
    const field = fieldResult.safeParse(evidence.field);
    const validLab = boundSource(
      evidence.lab,
      testedUrl,
      device,
      "psi",
      lab.success,
    );
    const read = field.success ? field.data : null;
    const target = new URL(testedUrl);
    // The stored URL is the form that passed the checks, not the worker's spelling of it.
    const fieldUrl = read ? speedFieldUrl(read.url) : undefined;
    const measuredField =
      read &&
      fieldUrl &&
      (read.level === "origin"
        ? new URL(fieldUrl).origin === target.origin &&
          new URL(fieldUrl).pathname === "/"
        : fieldUrl === target.href ||
          provenAggregate(read, evidence.field, target, device));
    rows.push({
      pageUrl,
      testedUrl,
      device,
      lab: !validLab
        ? { status: "unavailable" }
        : lab.success
          ? {
              status: "measured",
              ...lab.data,
              pageSpeed: details(evidence.lab),
            }
          : gap(evidence.lab, false),
      field: !boundSource(
        evidence.field,
        testedUrl,
        device,
        "crux",
        read?.level ?? false,
      )
        ? { status: "unavailable" }
        : measuredField
          ? {
              status: "measured",
              level:
                read.level === "url" &&
                read.identity?.pageAssessment === "not_determined"
                  ? "normalized"
                  : read.level,
              url: fieldUrl,
              p75: read.p75,
              period: read.period,
              ...readHistory(evidence.field, read.level),
            }
          : field.success
            ? { status: "unavailable" }
            : gap(evidence.field, true),
    });
  }
  return rows;
}

/**
 * A stored history as a fresh import stores it. None: it has no status Core knows, or its weeks are no
 * days, oldest first. A status that is not comparable stays alone, whatever else the history holds. Each
 * metric is read alone, and stays only with one value per week.
 */
function storedHistory(history: unknown): SpeedHistory | undefined {
  const raw = reportObject(history);
  const status = SPEED_HISTORY_STATUSES.find((value) => value === raw?.status);
  if (!raw || !status) return undefined;
  if (status !== "comparable" || raw.weeks == null) return { status };
  const days = speedHistory.shape.weeks.safeParse(raw.weeks);
  const weeks = days.data;
  if (!weeks || weeks.some((day, i) => i > 0 && day <= weeks[i - 1]!))
    return undefined;
  // A fresh import stores no empty series.
  if (!weeks.length) return { status };
  const kept: SpeedHistory = { status, weeks };
  let given = false;
  for (const key of ["lcp", "inp", "cls"] as const) {
    given ||= raw[key] != null;
    const points = speedHistory.shape[key].safeParse(raw[key]);
    if (points.data?.length === weeks.length) kept[key] = points.data;
  }
  // Metrics that all go leave no trend, as on a fresh import: the weeks alone would say "comparable".
  if (given && !kept.lcp && !kept.inp && !kept.cls)
    return { status: "unavailable" };
  return kept;
}

/**
 * One stored measurement before the schema reads it, with the guards of a fresh import. None: the page URL
 * or the tested URL is not public. The field URL gets the form a fresh import stores. A history Core cannot read and a lab insight
 * with text that is not public go, a Lighthouse version that is not plain is null; the measurement stays.
 */
export function readableStoredMeasurement(value: unknown): unknown[] {
  const row = reportObject(value);
  const [pageUrl, testedUrl] = [row?.pageUrl, row?.testedUrl].map(speedPageUrl);
  // The tested page is the page or a redirect on its host, as on a fresh import.
  if (
    !row ||
    !publicSpeedUrl(pageUrl) ||
    !publicSpeedUrl(testedUrl) ||
    !publicLanding(new URL(pageUrl), testedUrl)
  )
    return [];
  // The URLs get the form a fresh import stores: the table and the page list then name one page one way.
  const read: Record<string, unknown> = { ...row, pageUrl, testedUrl };
  const field = reportObject(row.field);
  if (field) {
    const { history, ...measured } = field;
    let foreign = false;
    if (field.url != null) {
      const url = speedFieldUrl(field.url);
      // A field URL that Core does not read, in a spelling or of a place, is no field data: the lab
      // measurement stays, as on a fresh import. Field data is of the tested page's origin; origin data
      // names the origin.
      foreign =
        !url ||
        new URL(url).origin !== new URL(testedUrl).origin ||
        (field.level === "origin" && new URL(url).pathname !== "/");
      if (url) measured.url = url;
    }
    // A comparable history with a series that is no object reads as a fresh import reads it: unavailable.
    const series = reportObject(history)?.series;
    const kept = storedHistory(history);
    read.field = foreign
      ? { status: "unavailable" }
      : !kept
        ? measured
        : kept.status === "comparable" &&
            series != null &&
            !reportObject(series)
          ? { ...measured, history: { status: "unavailable" } }
          : { ...measured, history: kept };
  }
  const lab = reportObject(row.lab);
  if (lab) {
    const { pageSpeed, ...measured } = lab;
    const details = reportObject(pageSpeed);
    const scores = lighthouseScores.safeParse(details?.scores);
    const measuredAt = z.string().datetime().safeParse(details?.measuredAt);
    read.lab = {
      ...measured,
      // A measured lab without the version reads as a fresh import reads it: null.
      ...(("lighthouse" in lab || "median" in lab) && {
        lighthouse: speedLighthouseVersion(lab.lighthouse),
      }),
      // The details read as a fresh import reads them: a part Core cannot read does not cost the device.
      ...(details && {
        pageSpeed: {
          scores: scores.success ? scores.data : {},
          // The first 20 are read: a longer list does not cost the device.
          insights: (Array.isArray(details.insights) ? details.insights : [])
            .slice(0, SPEED_INSIGHTS)
            .filter(
              (item) =>
                speedInsight.safeParse(item).success &&
                publicSpeedInsight(item),
            ),
          ...(measuredAt.success && { measuredAt: measuredAt.data }),
        },
      }),
    };
  }
  return [read];
}

const PAGE_SPEED_ROWS = 20;

/**
 * Stored page speed rows before the schema reads them. A measurement the row schema refuses goes, not the
 * audit: so does a collection that is no array, and each readable measurement past the schema's 20.
 */
export function readableStoredPageSpeed(rows: unknown) {
  return Array.isArray(rows)
    ? rows
        .flatMap(readableStoredMeasurement)
        .filter((row) => seoPageSpeedRow.safeParse(row).success)
        .slice(0, PAGE_SPEED_ROWS)
    : undefined;
}

export function scopedPageSpeed(
  rows: PageSpeedRows | undefined,
  selected: ReadonlySet<string>,
) {
  return rows?.filter((row) => selected.has(auditedSeoPageKey(row.pageUrl)));
}

/** Up to 100 audits reach one view: only the newest with page speed keeps its weekly series, the rest the status. */
function withoutSeries(rows: PageSpeedRows): PageSpeedRows {
  return rows.map((row) =>
    "history" in row.field && row.field.history
      ? {
          ...row,
          field: {
            ...row.field,
            history: { status: row.field.history.status },
          },
        }
      : row,
  );
}

/**
 * An audit's page speed for the view. An audit from before Core read it names the file to recover it from.
 * `newer` holds the view's audits so far: rows come newest first.
 */
export function observationPageSpeed(
  data: { kind: string; pageSpeed?: PageSpeedRows },
  row: {
    source: string;
    sourceFileId: string | null;
    sourceTaskId: string | null;
  },
  selected: ReadonlySet<string>,
  input: { marketRecoveryTaskIds?: ReadonlySet<string> },
  newer: ReadonlyArray<{ pageSpeed?: PageSpeedRows }>,
) {
  if (data.kind !== "audit_full") return {};
  if (data.pageSpeed !== undefined) {
    const pageSpeed = scopedPageSpeed(data.pageSpeed, selected) ?? [];
    return {
      pageSpeed: newer.some((item) => item.pageSpeed?.length)
        ? withoutSeries(pageSpeed)
        : pageSpeed,
    };
  }
  return row.source === "seo_coworker" &&
    row.sourceFileId &&
    row.sourceTaskId &&
    input.marketRecoveryTaskIds?.has(row.sourceTaskId)
    ? { pageSpeedRecoveryFileId: row.sourceFileId }
    : {};
}
