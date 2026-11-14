import type { Prisma } from "@sokosumi/database";

/** Whether a Cuso turn filed its report as a chat card (report_update). */
export async function cmoReportedByCard(
  tx: Prisma.TransactionClient,
  turnId: string,
  cmo: boolean,
): Promise<boolean> {
  if (!cmo) return false;
  const reports = await tx.sokoBotToolCall.count({
    where: { turnId, capability: "report_update", status: "COMPLETED" },
  });
  return reports > 0;
}

/**
 * Whether a Cuso turn saved his Brand Brain or strategy. Those writes carry
 * no action receipt, so without this a correction he applied would end on
 * "Nothing was changed in this turn."
 */
export async function cmoSavedRecord(
  tx: Prisma.TransactionClient,
  turnId: string,
  cmo: boolean,
): Promise<boolean> {
  if (!cmo) return false;
  const saves = await tx.sokoBotToolCall.count({
    where: {
      turnId,
      capability: { in: ["save_brand_brain", "save_strategy"] },
      status: "COMPLETED",
    },
  });
  return saves > 0;
}
