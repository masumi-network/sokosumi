import { randomBytes } from "node:crypto";
import { type CmoHire, type Prisma } from "@sokosumi/database";
import {
  type CmoReportUpdateInput,
  cmoReportUpdateInputSchema,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  CmoNotFoundError,
  getCmoHireForUser,
} from "@/services/cmo-cuso.service";
import { approveCmoStrategy } from "@/services/cmo-strategy.service";
import { approvedMarketingStrategy } from "@/services/marketing-strategy.service";

const cmoUpdateRecordSchema = cmoReportUpdateInputSchema.extend({
  id: z.string(),
  at: z.string(),
  /**
   * Weekly and monthly: the Marketing strategy version approved before this
   * turn wrote a new one; reverting approves it again.
   */
  previousVersionId: z.string().optional(),
  revertedAt: z.string().optional(),
});
export type CmoUpdateRecord = z.infer<typeof cmoUpdateRecordSchema>;

const UPDATES_LIMIT = 60;

export function parseCmoUpdates(value: unknown): CmoUpdateRecord[] {
  const parsed = z.array(cmoUpdateRecordSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Stores Cuso's report as a chat card. A weekly or monthly report that wrote
 * a new strategy version keeps the version approved before it, so the owner
 * can revert the whole review in one step.
 */
export async function reportCmoUpdate(
  input: {
    sokoBotId: string;
    turnId: string;
    update: CmoReportUpdateInput;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<CmoUpdateRecord> {
  const hire = await db.cmoHire.findUnique({
    where: { sokoBotId: input.sokoBotId },
  });
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const [wroteThisTurn, approved] =
    update.kind === "weekly" || update.kind === "monthly"
      ? await Promise.all([
          db.marketingStrategy.findFirst({
            where: { projectId: hire.projectId, turnId: input.turnId },
            select: { id: true },
          }),
          approvedMarketingStrategy(hire.projectId, db),
        ])
      : [null, null];
  const record: CmoUpdateRecord = {
    ...update,
    id: randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    ...(wroteThisTurn && approved && approved.id !== wroteThisTurn.id
      ? { previousVersionId: approved.id }
      : {}),
  };
  await db.cmoHire.update({
    where: { id: hire.id },
    data: {
      updates: [record, ...parseCmoUpdates(hire.updates)].slice(
        0,
        UPDATES_LIMIT,
      ),
    },
  });
  return record;
}

/**
 * Puts back the strategy a weekly review or monthly strategy replaced, by
 * approving the version that ran before it again.
 */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<CmoHire> {
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const updates = parseCmoUpdates(hire.updates);
  const target = updates.find((update) => update.id === input.updateId);
  if (!target?.previousVersionId) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return hire;
  await approveCmoStrategy(input.userId, target.previousVersionId);
  return prisma.cmoHire.update({
    where: { id: hire.id },
    data: {
      updates: updates.map((update) =>
        update.id === target.id
          ? { ...update, revertedAt: new Date().toISOString() }
          : update,
      ),
    },
  });
}
