import {
  buildSokoBotReaderJobWhere,
  buildSokoBotReaderTaskWhere,
  type SokoBotTurnReader,
} from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";

/**
 * The candidates the classifier may name, read at the same visibility seam
 * as the turn: a personal bot by audience, a shared bot by its scope. A
 * shared bot never reads a member's coworker assignments or own Jobs.
 */
export async function loadClassificationContext(
  reader: SokoBotTurnReader,
  workspaceId: string,
  message: string,
) {
  const { userId } = reader;
  const [projects, coworkers, agents, recentTasks, jobs] = await Promise.all([
    prisma.project.findMany({
      where: {
        workspaceId,
        ...(reader.sharedScope?.projectId
          ? { id: reader.sharedScope.projectId }
          : {}),
      },
      select: { id: true, name: true },
      take: 50,
    }),
    prisma.coworker.findMany({
      where: {
        archivedAt: null,
        OR: [
          { isWhitelisted: true },
          ...(reader.sharedScope
            ? []
            : [{ assignments: { some: { userId } } }]),
          { workspaceAccess: { some: { workspaceId, status: "GRANTED" } } },
        ],
      },
      select: { id: true, name: true },
      take: 50,
    }),
    prisma.agent.findMany({
      where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
      select: { id: true, name: true },
      take: 50,
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        ...buildSokoBotReaderTaskWhere(reader),
      },
      select: {
        id: true,
        name: true,
        status: true,
        ownerId: true,
        assigneeId: true,
        assigneeSokoBotId: true,
        projectId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.job.findMany({
      where: { ...buildSokoBotReaderJobWhere(reader), workspaceId },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);
  const references = [
    ...new Set(message.match(/\b[a-zA-Z0-9][a-zA-Z0-9_-]{15,80}\b/g) ?? []),
  ].slice(0, 10);
  const exactTasks = references.length
    ? await prisma.task.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          id: { in: references },
          ...buildSokoBotReaderTaskWhere(reader),
        },
        select: {
          id: true,
          name: true,
          status: true,
          ownerId: true,
          assigneeId: true,
          assigneeSokoBotId: true,
          projectId: true,
          updatedAt: true,
        },
        take: 10,
      })
    : [];
  // Search names at the same authorized seam as exact IDs. A quoted name
  // remains one phrase; otherwise use a small conjunction of distinctive words.
  const quotedName = message.match(/["“]([^"”]{3,120})["”]/u)?.[1];
  const ignoredWords = new Set(
    "what which where when how please could would should task tasks status update move archive assign project about with from that this these those into find show tell give have been done latest create research summary".split(
      " ",
    ),
  );
  const nameTerms = quotedName
    ? [quotedName]
    : [
        ...new Set(
          (
            message
              .slice(0, 1_000)
              .toLowerCase()
              .match(/[\p{L}\p{N}][\p{L}\p{N}_-]{3,39}/gu) ?? []
          ).filter((word) => !ignoredWords.has(word)),
        ),
      ].slice(0, 4);
  const namedTasks =
    reader.audience === "OWNER" && references.length === 0 && nameTerms.length
      ? await prisma.task.findMany({
          where: {
            workspaceId,
            archivedAt: null,
            ...buildSokoBotReaderTaskWhere(reader),
            AND: nameTerms.map((term) => ({
              name: { contains: term, mode: "insensitive" },
            })),
          },
          select: {
            id: true,
            name: true,
            status: true,
            ownerId: true,
            assigneeId: true,
            assigneeSokoBotId: true,
            projectId: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 11,
        })
      : [];
  const tasks = [
    ...new Map(
      [...exactTasks, ...namedTasks.slice(0, 10), ...recentTasks].map(
        (task) => [task.id, task],
      ),
    ).values(),
  ];
  return {
    projectIds: projects.map(({ id }) => id),
    coworkerIds: coworkers.map(({ id }) => id),
    agentIds: agents.map(({ id }) => id),
    taskIds: tasks.map(({ id }) => id),
    namedTaskIds: namedTasks.slice(0, 10).map(({ id }) => id),
    jobIds: jobs.map(({ id }) => id),
    candidates: [
      ...projects.map((row) => ({ ...row, kind: "PROJECT" })),
      ...coworkers.map((row) => ({ ...row, kind: "COWORKER" })),
      ...agents.map((row) => ({ ...row, kind: "AGENT" })),
      ...tasks.map((row) => ({ ...row, kind: "TASK" })),
      ...jobs.map((row) => ({ ...row, kind: "JOB" })),
    ],
  };
}
