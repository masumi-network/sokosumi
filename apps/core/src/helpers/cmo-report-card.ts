import { cmoReportUpdateInputSchema } from "@sokosumi/soko-bot";
import { z } from "zod";

/**
 * Cuso's reports are messages in his shared room (ADR 0062). The report
 * itself, with what a revert needs, is the message's private metadata under
 * this key; the room shows it as a `cmo_report` result card.
 */
export const CMO_REPORT_KEY = "cmo_report";
/** `clientMessageId` of a report message: `cmo-report:<turnId>:<toolCallId>`. */
export const CMO_REPORT_MESSAGE_PREFIX = "cmo-report:";

const cmoReportSchema = cmoReportUpdateInputSchema.extend({
  /** Weekly and monthly: the strategy before this turn's changes, for revert. */
  previousStrategy: z.json().optional(),
  revertedAt: z.string().optional(),
});
export type CmoReport = z.infer<typeof cmoReportSchema>;

/** The report a message carries; null for any other message. */
export function readCmoReport(metadata: unknown): CmoReport | null {
  const parsed = z
    .object({ [CMO_REPORT_KEY]: cmoReportSchema })
    .safeParse(metadata);
  return parsed.success ? parsed.data[CMO_REPORT_KEY] : null;
}

/** Where Cuso's report messages are: his own, in his shared room. */
export function cmoReportMessageWhere(sokoBotId: string) {
  return {
    senderSokoBotId: sokoBotId,
    deletedAt: null,
    clientMessageId: { startsWith: CMO_REPORT_MESSAGE_PREFIX },
    room: { sharedSokoBot: { id: sokoBotId } },
  };
}

const KIND_LABELS: Record<CmoReport["kind"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  brand: "Brand",
  request: "Request",
  production: "Production",
};

/** The result card's fields, for every Sokosumi chat client. */
export function cmoReportCard(report: CmoReport, projectId: string) {
  return {
    title: report.headline,
    status: report.revertedAt ? "Reverted" : KIND_LABELS[report.kind],
    summary: report.results ?? null,
    // The newest report is the Project's latest update.
    sourceHref: `/projects/${encodeURIComponent(projectId)}`,
    details: [
      ...report.changes.map((value) => ({ label: "Changed", value })),
      ...report.done.map((value) => ({ label: "Done", value })),
      ...report.upNext.map((value) => ({ label: "Up next", value })),
    ].slice(0, 8),
  };
}

/** The report as the Project's latest update: Markdown under a TL;DR. */
export function cmoReportMarkdown(report: CmoReport): string {
  const list = (title: string, items: string[]) =>
    items.length > 0
      ? [`## ${title}`, "", ...items.map((item) => `- ${item}`)]
      : [];
  return [
    [`# ${KIND_LABELS[report.kind]} report`],
    ["## TL;DR", "", report.headline],
    report.results ? ["## Results", "", report.results] : [],
    list("Changes", report.changes),
    list("Done", report.done),
    list("Up next", report.upNext),
  ]
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}
