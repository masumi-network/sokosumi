import {
  exceedsUnattendedHireBudget,
  unattendedHireOverCeilingRefusal,
  unattendedSecondHireRefusal,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";

export interface UnattendedHireInput {
  turn: { id: string; source: string | null; chainDepth: number };
  /** A shared bot asks the team in its room, not an owner. */
  shared: boolean;
  maxCredits: number;
  ceiling: number;
  toolCallId: string;
}

/**
 * Why a hire in a turn nobody asked for is refused, or null to allow it.
 *
 * A turn with no member message is composed from untrusted material: mail
 * subjects, calendar titles, task comments. Hiring is the one tool that buys
 * from a marketplace outright, so text that talks its way onto this route
 * must not be able to commit the whole balance in a single unattended turn.
 * A member asking for a hire themselves is unaffected.
 *
 * One hire per unattended turn, and that one under the ceiling. Summing what
 * the turn already committed looked more precise and was not: a tool input
 * over 16KB is persisted as a truncated preview, so `maxCredits` disappears
 * from the stored row and every prior hire sums to zero. Counting rows cannot
 * be defeated that way, and it matches the prompt's own rule of one
 * initiative per turn.
 */
export async function unattendedHireRefusal(
  input: UnattendedHireInput,
): Promise<string | null> {
  const { turn, ceiling } = input;
  const unattended = exceedsUnattendedHireBudget({
    source: turn.source,
    chainDepth: turn.chainDepth,
    maxCredits: Number.POSITIVE_INFINITY,
    ceiling,
  });
  if (unattended) {
    const priorHires = await prisma.sokoBotToolCall.count({
      where: {
        turnId: turn.id,
        capability: "hire_agent",
        NOT: { toolCallId: input.toolCallId },
      },
    });
    if (priorHires > 0) return unattendedSecondHireRefusal(input.shared);
  }
  return exceedsUnattendedHireBudget({
    source: turn.source,
    chainDepth: turn.chainDepth,
    maxCredits: input.maxCredits,
    ceiling,
  })
    ? unattendedHireOverCeilingRefusal(input.shared, ceiling, input.maxCredits)
    : null;
}
