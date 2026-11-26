import prisma from "@/lib/db/prisma";

/**
 * Re-reading a Task or Job that this turn's request handed out with a
 * follow-up, when nothing changed since this turn last read it. Core wakes
 * the bot with the result and the plan when it changes; a background run
 * that polled CodePat's Task in a loop instead never settled, and the wake
 * carrying the answer waited behind it (owner benchmark, run 01a2160e).
 */
export async function repeatedPollRefusal(
  turnId: string,
  work: { kind: "TASK"; taskId: string } | { kind: "JOB"; jobId: string },
): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { parentTurnId: true },
  });
  const requestTurns = [
    turnId,
    ...(turn?.parentTurnId ? [turn.parentTurnId] : []),
  ];
  const target =
    work.kind === "TASK" ? { taskId: work.taskId } : { jobId: work.jobId };
  const delegation = await prisma.sokoBotDelegation.findFirst({
    where: {
      ...target,
      turnId: { in: requestTurns },
      followUp: { not: null },
      followUpTurnId: null,
    },
    select: { followUp: true },
  });
  if (!delegation?.followUp) return null;
  const latest =
    work.kind === "TASK"
      ? await prisma.taskEvent.findFirst({
          where: { taskId: work.taskId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true },
        })
      : await prisma.jobEvent.findFirst({
          where: { jobId: work.jobId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true },
        });
  const field = work.kind === "TASK" ? "taskId" : "jobId";
  const readSinceChange = await prisma.sokoBotToolCall.findFirst({
    where: {
      turnId,
      capability: work.kind === "TASK" ? "get_task_status" : "get_job_status",
      status: "COMPLETED",
      input: {
        path: [field],
        equals: work.kind === "TASK" ? work.taskId : work.jobId,
      },
      ...(latest ? { updatedAt: { gte: latest.createdAt } } : {}),
    },
    select: { id: true },
  });
  if (!readSinceChange) return null;
  const what = work.kind === "TASK" ? "Task" : "Job";
  return `This ${what} has not changed since you last read it. Core wakes you with its result and your plan ("${delegation.followUp}") as soon as it changes, so do not check it again: end this turn now and say in one sentence what you are waiting for.`;
}
