import prisma from "@/lib/db/prisma";
import {
  JOB_WAKE_STATUSES,
  TASK_WAKE_STATUSES,
} from "@/lib/soko-bot/delegation-wake";

/** How far up a run's parents the request that handed the work out may be. */
const MAX_REQUEST_HOPS = 4;

/**
 * A status the bot is woken for: the work finished, failed or waits on
 * someone. Reads of it are never refused, since the run that read it before
 * may have used up the wake.
 */
const WAKES = { TASK: TASK_WAKE_STATUSES, JOB: JOB_WAKE_STATUSES } as const;

/** This turn and the turns that started it, nearest first. */
async function requestTurnIds(turnId: string): Promise<string[]> {
  const ids = [turnId];
  let current: string | null = turnId;
  for (let hop = 0; current && hop < MAX_REQUEST_HOPS; hop++) {
    const turn: { parentTurnId: string | null } | null =
      await prisma.sokoBotTurn.findUnique({
        where: { id: current },
        select: { parentTurnId: true },
      });
    current = turn?.parentTurnId ?? null;
    if (current && !ids.includes(current)) ids.push(current);
  }
  return ids;
}

/**
 * Re-reading a Task or Job this request handed out with a follow-up, while
 * it still runs and nothing changed since this turn last read it. Core wakes
 * the bot with the result and the plan when it changes; a background run
 * that polled a Coworker's Task in a loop instead never settled, and the
 * wake carrying the answer waited behind it (owner benchmark, 2026-11-26).
 */
export async function repeatedPollRefusal(
  turnId: string,
  work: { kind: "TASK"; taskId: string } | { kind: "JOB"; jobId: string },
): Promise<string | null> {
  const target =
    work.kind === "TASK" ? { taskId: work.taskId } : { jobId: work.jobId };
  const delegation = await prisma.sokoBotDelegation.findFirst({
    where: {
      ...target,
      turnId: { in: await requestTurnIds(turnId) },
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
          select: { createdAt: true, status: true },
        })
      : await prisma.jobEvent.findFirst({
          where: { jobId: work.jobId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true, status: true },
        });
  // The Task's own status: its latest event can be a comment without one.
  const status =
    work.kind === "TASK"
      ? (
          await prisma.task.findUnique({
            where: { id: work.taskId },
            select: { status: true },
          })
        )?.status
      : latest?.status;
  if (status && WAKES[work.kind].has(status)) return null;
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
      // When the read started: one that began before the change and was
      // saved after it did not see the change.
      ...(latest ? { createdAt: { gt: latest.createdAt } } : {}),
    },
    select: { id: true },
  });
  if (!readSinceChange) return null;
  const what = work.kind === "TASK" ? "Task" : "Job";
  return `This ${what} is still running and has not changed since you last read it. Core wakes you with its result and your plan ("${delegation.followUp}") as soon as it changes, so do not check it again: finish any other step you can do now, then end your turn and say what you are waiting for.`;
}
