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
