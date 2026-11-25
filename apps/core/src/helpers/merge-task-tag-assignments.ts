import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

/** Both vocabulary rows are already locked, in UUID order, for this transaction. */
export async function mergeTaskTagAssignments(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
) {
  // A person keeping either spelling takes precedence over model assignments.
  await tx.$executeRaw`
    UPDATE ${sharedTable("task_workspace_tag")} AS target SET state = 'MANUAL'
    FROM ${sharedTable("task_workspace_tag")} AS source
    WHERE target."taskId" = source."taskId"
      AND target."labelId" = ${targetId}::uuid AND source."labelId" = ${sourceId}::uuid
      AND target.state = 'JEV_ADDED' AND source.state = 'MANUAL'
  `;
  // Update assignments in place. A concurrent removal or workspace
  // move then deletes the same row and cannot leave a copied tag behind.
  await tx.$executeRaw`
    DELETE FROM ${sharedTable("task_workspace_tag")} AS source
    USING ${sharedTable("task_workspace_tag")} AS target
    WHERE source."labelId" = ${sourceId}::uuid
      AND target."labelId" = ${targetId}::uuid
      AND source."taskId" = target."taskId"
  `;
  await tx.taskWorkspaceTag.updateMany({
    where: { labelId: sourceId },
    data: { labelId: targetId },
  });

  // Preserve a veto from either spelling when the other was only suggested.
  await tx.$executeRaw`
    UPDATE ${sharedTable("task_workspace_tag_decision")} AS target SET state = 'JEV_DISMISSED'
    FROM ${sharedTable("task_workspace_tag_decision")} AS source
    WHERE target."taskId" = source."taskId"
      AND target."labelId" = ${targetId}::uuid AND source."labelId" = ${sourceId}::uuid
      AND target.state = 'JEV_SUGGESTED' AND source.state = 'JEV_DISMISSED'
  `;
  await tx.$executeRaw`
    DELETE FROM ${sharedTable("task_workspace_tag_decision")} AS source
    USING ${sharedTable("task_workspace_tag_decision")} AS target
    WHERE source."taskId" = target."taskId"
      AND source."labelId" = ${sourceId}::uuid AND target."labelId" = ${targetId}::uuid
  `;
  await tx.taskWorkspaceTagDecision.updateMany({
    where: { labelId: sourceId },
    data: { labelId: targetId },
  });

  // Resolve the cases where only one spelling had an applied assignment.
  await tx.$executeRaw`
    DELETE FROM ${sharedTable("task_workspace_tag")} AS assignment USING ${sharedTable("task_workspace_tag_decision")} AS decision
    WHERE assignment."labelId" = ${targetId}::uuid AND assignment."labelId" = decision."labelId"
      AND assignment."taskId" = decision."taskId"
      AND assignment.state = 'JEV_ADDED' AND decision.state = 'JEV_DISMISSED'
  `;
  await tx.$executeRaw`
    DELETE FROM ${sharedTable("task_workspace_tag_decision")} AS decision USING ${sharedTable("task_workspace_tag")} AS assignment
    WHERE decision."labelId" = ${targetId}::uuid AND decision."labelId" = assignment."labelId"
      AND decision."taskId" = assignment."taskId"
  `;
}
