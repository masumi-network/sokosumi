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
  /**
   * Weekly and monthly: the Marketing strategy version approved before this
   * turn wrote a new one; reverting approves it again.
   */
  previousVersionId: z.string().optional(),
  /** The version this turn wrote: reverting discards it while unapproved. */
  versionId: z.string().optional(),
  revertedAt: z.string().optional(),
  /**
   * Set by Core, never Cuso: the strategy change this request saved waits
   * for the owner's approval, so no upcoming post has changed yet.
   */
  awaitsApproval: z.literal(true).optional(),
});

const AWAITS_APPROVAL =
  "Your upcoming posts change once you approve the new strategy.";
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

/**
 * The result card's fields, for every Sokosumi chat client. A production
 * round is progress on the month, so its card is the headline alone; its
 * lists stay in the Project's latest update.
 */
export function cmoReportCard(report: CmoReport, projectId: string) {
  const production = report.kind === "production";
  const proposed = proposedLines(report);
  return {
    title: cmoReportTitle(report),
    status: report.revertedAt
      ? "Reverted"
      : proposed
        ? "Waits for your approval"
        : KIND_LABELS[report.kind],
    summary: production || proposed ? null : (report.results ?? null),
    // The newest report is the Project's latest update.
    sourceHref: `/projects/${encodeURIComponent(projectId)}`,
    details: production
      ? []
      : [
          ...(proposed
            ? [
                { label: "Not yet", value: AWAITS_APPROVAL },
                ...proposed.map((value) => ({ label: "Proposed", value })),
              ]
            : [
                ...report.changes.map((value) => ({ label: "Changed", value })),
                ...report.done.map((value) => ({ label: "Done", value })),
              ]),
          ...report.upNext.map((value) => ({ label: "Up next", value })),
        ].slice(0, 8),
  };
}

/**
 * Nothing ran yet: everything Cuso wrote, his headline included, is what he
 * proposes. Null when the report is not waiting on the owner.
 */
function proposedLines(report: CmoReport): string[] | null {
  if (!report.awaitsApproval || report.revertedAt) return null;
  return [
    report.headline,
    ...(report.results ? [report.results] : []),
    ...report.changes,
    ...report.done,
  ];
}

/** The card's title and chat text: Core's own words while the change waits. */
export function cmoReportTitle(report: CmoReport): string {
  return proposedLines(report) ? AWAITS_APPROVAL_TITLE : report.headline;
}

const AWAITS_APPROVAL_TITLE = "A strategy change waits for your approval";

/**
 * The report as CMO shows it to the owner. A change still waiting for
 * approval ticks nothing off: Core's title leads, and Cuso's lines are what
 * comes once the owner approves.
 */
export function cmoReportForOwner<T extends CmoReport>(report: T): T {
  const proposed = proposedLines(report);
  return proposed
    ? {
        ...report,
        headline: AWAITS_APPROVAL_TITLE,
        results: undefined,
        changes: [],
        done: [],
        upNext: [AWAITS_APPROVAL, ...proposed, ...report.upNext].slice(0, 12),
      }
    : report;
}

/** The report as the Project's latest update: Markdown under a TL;DR. */
export function cmoReportMarkdown(report: CmoReport): string {
  const list = (title: string, items: string[]) =>
    items.length > 0
      ? [`## ${title}`, "", ...items.map((item) => `- ${item}`)]
      : [];
  const proposed = proposedLines(report);
  return [
    [`# ${KIND_LABELS[report.kind]} report`],
    ["## TL;DR", "", cmoReportTitle(report)],
    ...(proposed
      ? [["## Not yet", "", AWAITS_APPROVAL], list("Proposed", proposed)]
      : [
          report.results ? ["## Results", "", report.results] : [],
          list("Changes", report.changes),
          list("Done", report.done),
        ]),
    list("Up next", report.upNext),
  ]
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}
