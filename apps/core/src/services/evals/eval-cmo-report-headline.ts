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
