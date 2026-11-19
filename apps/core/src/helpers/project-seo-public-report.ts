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
    input.pages.forEach((page) =>
      refusePrivateReport(reportObject(page)?.report ?? page),
    );
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
  const failed: ("seasonal" | "exploration" | "searchInvestigation")[] = [];
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
  if (site && Array.isArray(input.specialistFailures)) {
    for (const stage of ["exploration", "searchInvestigation"] as const) {
      if (input.specialistFailures.includes(stage)) failed.push(stage);
    }
  }
  return failed;
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
