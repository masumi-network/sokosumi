import { z } from "zod";
import { badRequest } from "@/helpers/error";
import { seoUrlSchema } from "@/schemas/seo-page.schema";

export const reportObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const PRIVATE_FIELDS = [
  "bing",
  "searchConsole",
  "searchConsoleNear",
  "searchHistory",
  "privateTopicQueries",
  "ownerExplorationRequest",
  "privateStrategyDecisions",
  "outcomes",
  "outcomeEvidence",
  "outcomeReading",
  "searchOutcomes",
  "businessOutcome",
  "pageComparison",
];
export function refusePrivateReport(raw: unknown): void {
  const input = reportObject(raw);
  const request = reportObject(input?.request);
  if (
    !input ||
    PRIVATE_FIELDS.some((key) => input[key] !== undefined) ||
    (request &&
      (["outcomeSnapshot", "outcomeImport", "outcomes", "outcome"].some(
        (key) => request[key] !== undefined,
      ) ||
        (Array.isArray(request.connections) && request.connections.length > 0)))
  )
    throw badRequest("Only public SEO evidence can be imported");
  const header = reportObject(input.header);
  if (
    Array.isArray(header?.focusKeywords) &&
    header.focusKeywords.some((row) => {
      const item = reportObject(row);
      return (
        item &&
        ["searchConsole", "searchConsoleNote", "primary"].some(
          (key) => item[key] !== undefined,
        )
      );
    })
  )
    throw badRequest("Private search evidence cannot be imported");
  if (Array.isArray(input.pages))
    input.pages.forEach((page) => {
      const child = reportObject(page)?.report ?? page;
      // A text or a number holds no private field: its parser decides whether the page is readable.
      if (child !== null && typeof child === "object")
        refusePrivateReport(child);
    });
}

const SEARCH_CONSOLE_FIELDS = [
  "searchConsole",
  "searchConsoleNear",
  "searchHistory",
  // The worker fills this from the Search Console investigation of a granted Task.
  "privateStrategyDecisions",
];
const SEARCH_CONSOLE_KEYWORD_FIELDS = [
  "searchConsole",
  "searchConsoleNote",
  "primary",
];
const SEARCH_CONSOLE_CONNECTION = "search_console";

function omitKeys(input: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !keys.includes(key)),
  );
}

/**
 * A report file of an audit approved with Search Console may hold the worker's
 * Search Console sections. The owner decided this on 2026-11-21. Core still
 * stores none of these sections, so it drops them before the public
 * projection. Every other private field still reaches refusePrivateReport.
 */
export function withoutApprovedSearchConsole(raw: unknown): unknown {
  const input = reportObject(raw);
  if (!input) return raw;
  const copy = omitKeys(input, SEARCH_CONSOLE_FIELDS);
  const request = reportObject(input.request);
  if (
    request &&
    Array.isArray(request.connections) &&
    request.connections.every((item) => item === SEARCH_CONSOLE_CONNECTION)
  )
    copy.request = omitKeys(request, ["connections"]);
  const header = reportObject(input.header);
  if (header && Array.isArray(header.focusKeywords))
    copy.header = {
      ...header,
      focusKeywords: header.focusKeywords.map((row) => {
        const item = reportObject(row);
        return item ? omitKeys(item, SEARCH_CONSOLE_KEYWORD_FIELDS) : row;
      }),
    };
  if (Array.isArray(input.pages))
    copy.pages = input.pages.map((page) => {
      const item = reportObject(page);
      return item && item.report !== undefined
        ? { ...item, report: withoutApprovedSearchConsole(item.report) }
        : withoutApprovedSearchConsole(page);
    });
  return copy;
}

// Emitted by the worker for a page that started and raised an exception.
export const SEO_REPORT_IMPORT_REJECTED =
  "The source report or its current authority could not be validated";
export const SEO_PAGE_RUN_FAILURE_PREFIX = "the page Run failed: ";
export function failedPageRuns(
  skipped: readonly { url: string; reason: string }[],
): number {
  return new Set(
    skipped
      .filter((row) => row.reason.startsWith(SEO_PAGE_RUN_FAILURE_PREFIX))
      .map((row) => row.url),
  ).size;
}

/** Read only the worker's stage codes after the artifact and Task ownership checks. Never retain provider messages. */
export function failedSeoSpecialists(raw: unknown) {
  const input = reportObject(raw);
  const site = input?.kind === "site";
  const pages = site && Array.isArray(input.pages) ? input.pages : [input];
  const editorialStages = [
    "editorialGemini",
    "editorialCodex",
    "editorialValidation",
  ] as const;
  const failed: (
    | "seasonal"
    | "exploration"
    | "searchInvestigation"
    | "speedPages"
    | (typeof editorialStages)[number]
  )[] = [];
  if (
    pages.some((page) => {
      const status = reportObject(
        reportObject(reportObject(page)?.seasonalReview)?.status,
      );
      return [status?.demand, status?.audience].some(
        (value) =>
          value === "failed" || value === "invalid" || value === "unrecorded",
      );
    })
  )
    failed.push("seasonal");
  if (Array.isArray(input?.specialistFailures)) {
    if (input.specialistFailures.includes("exploration"))
      failed.push("exploration");
    if (site && input.specialistFailures.includes("searchInvestigation"))
      failed.push("searchInvestigation");
    // The model that picks the extra pages of the site speed test (seo-bot `speed-pages.ts`).
    if (site && input.specialistFailures.includes("speedPages"))
      failed.push("speedPages");
  }
  for (const stage of editorialStages) {
    if (
      pages.some((page) => {
        const stages = reportObject(page)?.specialistFailures;
        return Array.isArray(stages) && stages.includes(stage);
      })
    )
      failed.push(stage);
  }
  return failed;
}

/** The worker's codes for an outside data source that gave no answer (seo-bot `source-failures.ts`). */
export const SEO_SOURCE_FAILURES = [
  "webRiskNotRun",
  "webRiskFailed",
  "lighthouseFailed",
] as const;

/**
 * Keep only known codes, from any page of the report. The worker sets them on page reports only,
 * so a site report's own field is not read. Never retain provider messages.
 */
export function failedSeoSources(raw: unknown) {
  const input = reportObject(raw);
  const pages =
    input?.kind === "site" && Array.isArray(input.pages)
      ? input.pages
      : [input];
  return SEO_SOURCE_FAILURES.filter((code) =>
    pages.some((page) => {
      const codes = reportObject(page)?.sourceFailures;
      return Array.isArray(codes) && codes.includes(code);
    }),
  );
}

// Prisma rejects explicit undefined inside JSON. Zod can retain it for an absent or unreadable optional field.
export function omitUndefinedProperties<T extends object>(parsed: T): T {
  for (const key of Object.keys(parsed) as (keyof T)[]) {
    const value = parsed[key];
    if (value === undefined) delete parsed[key];
    else if (value !== null && typeof value === "object")
      omitUndefinedProperties(value);
  }
  return parsed;
}

// A site audit keeps going when one page Run fails. The worker names that page in `selection.skipped`.
const siteSkipped = z.object({
  selection: z.object({
    skipped: z
      .array(z.object({ url: seoUrlSchema, reason: z.string() }))
      .max(10),
  }),
});
export const skippedPages = (raw: unknown) => {
  if (reportObject(raw)?.kind !== "site") return [];
  const parsed = siteSkipped.safeParse(raw);
  return parsed.success ? parsed.data.selection.skipped : [];
};

export const finiteReportNumber = (
  value: unknown,
  keys: string[],
): number | null => {
  let current = value;
  for (const key of keys) current = reportObject(current)?.[key];
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
};
