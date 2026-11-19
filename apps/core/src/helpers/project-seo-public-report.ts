import { badRequest } from "@/helpers/error";

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
