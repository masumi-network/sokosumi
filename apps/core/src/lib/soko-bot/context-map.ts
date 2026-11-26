import { TaskStatus } from "@sokosumi/database";
import { DAY_MS } from "@/config/constants";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import prisma from "@/lib/db/prisma";
import { resolveProvider } from "@/services/soko-bot-integrations.service";
import type { PacketMapFacts, SokoBotPacketPlan } from "./context-organizer";
import type { ContextPacketScope } from "./context-packet-scope";

/** A Task in one of these waits on a person, not on the Coworker. */
export const WAITING_TASK_STATUSES = [
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.GRANT_PENDING,
] as const satisfies readonly TaskStatus[];

const WEEK_MS = 7 * DAY_MS;

/** The rhythm a schedule turn runs, from its client turn id. */
export async function scheduleKeyOf(turn: {
  source: string;
  clientTurnId?: string | null;
}): Promise<string | null> {
  if (turn.source !== "SCHEDULE") return null;
  const scheduleId = /^schedule:([0-9a-f-]{36}):/.exec(
    turn.clientTurnId ?? "",
  )?.[1];
  if (!scheduleId) return null;
  const schedule = await prisma.sokoBotSchedule
    .findUnique({ where: { id: scheduleId }, select: { systemKey: true } })
    .catch(() => null);
  return schedule?.systemKey ?? null;
}

export async function loadPacketMapFacts(input: {
  plan: SokoBotPacketPlan;
  sokoBotId: string;
  workspaceId: string;
  scope: ContextPacketScope;
  waitingWhere: object;
  memoryMarkdown: string;
  privateAudience: boolean;
  xDms: boolean;
}): Promise<PacketMapFacts> {
  const board = {
    workspaceId: input.workspaceId,
    archivedAt: null,
    ...input.scope.taskWhere,
  };
  const [openTasks, waitingTasks, finishedThisWeek, integrations] =
    await Promise.all([
      prisma.task.count({
        where: { ...board, status: { notIn: [...SETTLED_TASK_STATUSES] } },
      }),
      prisma.task.count({ where: { ...board, ...input.waitingWhere } }),
      prisma.task.count({
        where: {
          ...board,
          status: { in: [...SETTLED_TASK_STATUSES] },
          updatedAt: { gte: new Date(Date.now() - WEEK_MS) },
        },
      }),
      input.privateAudience
        ? []
        : prisma.sokoBotIntegration.findMany({
            where: { sokoBotId: input.sokoBotId, status: "ACTIVE" },
            select: { provider: true },
          }),
    ]);
  const providers = integrations.flatMap((row) => {
    try {
      return [resolveProvider(row.provider)];
    } catch {
      return [];
    }
  });
  return {
    plan: input.plan,
    openTasks,
    waitingTasks,
    finishedThisWeek,
    memoryBytes: Buffer.byteLength(input.memoryMarkdown, "utf8"),
    mail: providers
      .filter((provider) => provider.kinds.includes("email"))
      .map((provider) => provider.id),
    calendar: providers
      .filter((provider) => provider.kinds.includes("calendar"))
      .map((provider) => provider.id),
    providers: providers.map((provider) => provider.id),
    privateAudience: input.privateAudience,
    xDms: input.xDms && !input.privateAudience,
  };
}
