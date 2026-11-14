import { isSokoBotSilentAnswer } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "./action-receipts";
import {
  ACTION_LABELS,
  type ActionNarrative,
  HELD_BACK_REPLY,
  parseActionNarrativeText,
} from "./action-response";
import {
  claimsAction,
  MAX_READ_OBSERVATIONS,
  type ReadObservation,
} from "./answer-claims";
import { readAnswerResponse } from "./read-answer-response";
import { READ_OBSERVATION_CAPABILITIES } from "./read-observations";

const CLAIM_CHECK_READS = new Set([
  ...READ_OBSERVATION_CAPABILITIES,
  "read_file",
  "list_files",
  "list_tasks",
]);
const ownerReadTurn = z.object({
  source: z.literal("CHAT"),
  route: z.literal("DIRECT_RESPONSE"),
  contextSnapshot: z.object({
    packet: z.object({
      trigger: z.object({
        source: z.literal("CHAT"),
        route: z.literal("DIRECT_RESPONSE"),
        askedBy: z.object({ kind: z.literal("OWNER") }),
      }),
    }),
  }),
});

/** Receipts prove changes; successful reads explain whose activity a reply reports. */
async function turnEvidence(turnId: string): Promise<{
  confirmedChanges: string[];
  readObservations: ReadObservation[];
  observationToolCallIds: string[];
}> {
  const [calls, reads] = await Promise.all([
    prisma.sokoBotToolCall.findMany({
      where: {
        turnId,
        status: "COMPLETED",
        capability: { in: [...ACTION_CAPABILITIES] },
        disposition: { in: ["APPLIED", "ALREADY_SATISFIED"] },
      },
      select: { capability: true },
    }),
    prisma.sokoBotToolCall.findMany({
      where: {
        turnId,
        status: "COMPLETED",
        capability: { in: [...CLAIM_CHECK_READS] },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_READ_OBSERVATIONS,
      select: { capability: true, result: true, toolCallId: true },
    }),
  ]);
  return {
    confirmedChanges: [
      ...new Set(
        calls
          .filter((call) => ACTION_CAPABILITIES.has(call.capability))
          .map((call) => ACTION_LABELS[call.capability] ?? call.capability),
      ),
    ],
    readObservations: reads
      .filter((call) => CLAIM_CHECK_READS.has(call.capability))
      .map(({ capability, result }) => ({ capability, result })),
    observationToolCallIds: [
      ...new Set(
        reads
          .filter((call) =>
            READ_OBSERVATION_CAPABILITIES.some(
              (capability) => capability === call.capability,
            ),
          )
          .flatMap((call) =>
            typeof call.toolCallId === "string" ? [call.toolCallId] : [],
          ),
      ),
    ],
  };
}

async function readSource(turnId: string) {
  return prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: {
      source: true,
      route: true,
      userMessage: true,
      contextSnapshot: { select: { packet: true } },
      toolCalls: {
        where: { capability: "list_tasks", status: "COMPLETED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          capability: true,
          status: true,
          input: true,
          result: true,
          createdAt: true,
        },
      },
    },
  });
}

/** Keep only verified read references; rejected or unchecked prose is never restored. */
async function recoveredReadNarrative(
  turnId: string,
  evidence: Awaited<ReturnType<typeof turnEvidence>>,
  source: unknown,
): Promise<ActionNarrative | undefined> {
  if (
    evidence.confirmedChanges.length === 0 &&
    ownerReadTurn.safeParse(source).success &&
    evidence.observationToolCallIds.length
  ) {
    const disallowed = await prisma.sokoBotToolCall.findFirst({
      where: {
        turnId,
        OR: [
          { status: { not: "COMPLETED" } },
          { capability: { notIn: [...CLAIM_CHECK_READS] } },
        ],
      },
      select: { id: true },
    });
    if (!disallowed)
      return {
        kind: "REPORT",
        message: null,
        question: null,
        observationToolCallIds: evidence.observationToolCallIds,
      };
  }
  return undefined;
}

/**
 * The model's words for the owner on a turn that could act. Its reply is
 * meant to be the JSON narrative; plain prose is kept as its message too. A
 * message that claims an action is dropped, since only receipts may.
 */
export async function ownerNarrative(
  text: string,
  turnId: string,
): Promise<ActionNarrative | undefined> {
  // An explicit silence signal is not an empty model answer.
  if (text.trim() && isSokoBotSilentAnswer(text)) return undefined;
  const parsed = parseActionNarrativeText(text);
  const narrative: ActionNarrative | null =
    parsed ??
    (text.trim()
      ? {
          kind: "REPORT",
          message: text.trim(),
          question: null,
          observationToolCallIds: [],
        }
      : null);
  if (!narrative?.message) {
    if (!narrative || narrative.kind === "REPORT") {
      const evidence = await turnEvidence(turnId);
      if (
        evidence.confirmedChanges.length === 0 &&
        evidence.observationToolCallIds.length
      ) {
        const recovered = await recoveredReadNarrative(
          turnId,
          evidence,
          await readSource(turnId),
        );
        if (recovered) return recovered;
      }
    }
    return narrative ?? undefined;
  }
  const evidence = await turnEvidence(turnId);
  const claim = await claimsAction(
    narrative.message,
    evidence.confirmedChanges,
    evidence.readObservations,
  );
  if (claim === false) return narrative;
  // Counted, never quoted: how often a reply is withheld is the signal.
  console.warn("Soko Bot reply withheld", {
    turnId,
    reason: claim === null ? "unchecked" : "claims_unconfirmed_change",
  });
  const source =
    claim === true && evidence.confirmedChanges.length === 0
      ? await readSource(turnId)
      : null;
  const recall = source ? readAnswerResponse(source) : null;
  if (recall) {
    return {
      kind: "REPORT",
      message: recall,
      question: null,
      observationToolCallIds: [],
    };
  }
  const recovered =
    claim === true && narrative.kind === "REPORT"
      ? await recoveredReadNarrative(turnId, evidence, source)
      : undefined;
  if (recovered) return recovered;
  // A claim is dropped: the receipts say what changed, or that nothing did.
  // An unchecked reply is not shown either, but the owner is told why.
  return {
    ...narrative,
    message: claim === null ? HELD_BACK_REPLY : null,
  };
}
