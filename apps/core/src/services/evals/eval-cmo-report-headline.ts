import type { ScenarioCheck } from "@sokosumi/soko-bot";

import {
  CMO_REPORT_MESSAGE_PREFIX,
  readCmoReport,
} from "@/helpers/cmo-report-card";
import prisma from "@/lib/db/prisma";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";

/** The case whose report card's title is read after the turn. */
export const REPORT_HEADLINE_CASE_ID = "cmo-change-request";

const MAX_HEADLINE_WORDS = 14;
/** Words a report once used for "I fixed it": the owner never says them. */
const JARGON = /\b(?:captured|aligned|starting facts|reconciled|synced)\b/i;

/**
 * What is wrong with a report card's title, or null: it is one short plain
 * sentence, not two clauses joined by a semicolon, and not written in
 * internal terms ("Brand Brain corrections captured; strategy starting
 * facts aligned").
 */
export function headlineProblem(headline: string): string | null {
  if (headline.includes(";")) return "two clauses joined by a semicolon";
  if (JARGON.test(headline)) return "internal terms";
  const words = headline.trim().split(/\s+/).length;
  return words > MAX_HEADLINE_WORDS ? `${words} words` : null;
}

/**
 * The report cards the turn filed, each with a plain title. A turn that
 * filed none is not failed here: whether it should have is the rubric's call.
 */
export async function reportHeadlineChecks(
  lane: EvalLaneRecord,
  startedAt: Date,
): Promise<ScenarioCheck[]> {
  const messages = await prisma.chatRoomMessage.findMany({
    where: {
      senderSokoBotId: lane.cusoBotId,
      clientMessageId: { startsWith: CMO_REPORT_MESSAGE_PREFIX },
      createdAt: { gte: startedAt },
    },
    select: { metadata: true },
  });
  const headlines = messages.flatMap(
    (message) => readCmoReport(message.metadata)?.headline ?? [],
  );
  const wrong = headlines.find((headline) => headlineProblem(headline));
  return [
    {
      label: "Titles his report card in one plain sentence",
      pass: wrong === undefined,
      actual: wrong
        ? `"${wrong}": ${headlineProblem(wrong)}`
        : (headlines[0] ?? "no report card"),
    },
  ];
}

/** An answer that hands the calendar back to the owner (NMKR, 2026-11-21). */
const ASKS_FOR_CALENDAR =
  /\b(?:send|share|paste|give)\b[^.?!]{0,40}\b(?:full|whole|entire|complete)?\s*(?:strategy\s+)?calendar\b/i;

/**
 * A change to part of the month saves only the entries it changes: a whole
 * calendar does not fit in Cuso's context on a long month, and once had him
 * ask the owner for "the full strategy calendar".
 */
export function partPatchChecks(
  calls: readonly { capability: string; input: unknown }[],
  answer: string,
): ScenarioCheck[] {
  const whole = calls
    .filter((call) => call.capability === "save_strategy")
    .map((call) => (call.input as { part?: string } | null)?.part ?? "all")
    .filter((part) => part === "calendar" || part === "all");
  const asks = ASKS_FOR_CALENDAR.exec(answer)?.[0];
  return [
    {
      label: "Saves only the entries he changes (part patch)",
      pass: whole.length === 0,
      actual: whole.length
        ? `save_strategy part ${whole.join(", ")}`
        : "part patch",
    },
    {
      label: "Never asks the owner for the calendar",
      pass: asks === undefined,
      actual: asks ? `"${asks}"` : "does not ask",
    },
  ];
}
