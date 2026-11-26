import type { Prisma } from "@sokosumi/database";

import { taskDescriptionMatches } from "@/helpers/seo-audit-search-hits";
import prisma from "@/lib/db/prisma";

export const DRIVE_TASK_FILE_WHERE = {
  status: "READY",
  origin: "TASK_OUTPUT",
  fileUrl: { not: null },
} as const satisfies Prisma.TaskFileWhereInput;

export interface DriveTaskOutputRecentsRow {
  id: string;
  name: string;
  fileUrl: string;
  size: number | null;
  updatedAt: Date;
  taskId: string;
  taskName: string;
  projectId: string | null;
  projectName: string | null;
}

/**
 * The READY task-output files a Drive view lists, matched by file name, Task
 * name or the Task description a reader sees.
 *
 * `rawReaderCoworkerId`: the authenticated Coworker; it finds its own Tasks by
 * their raw description (see `taskDescriptionMatches`).
 */
export async function buildDriveTaskFileWhere(input: {
  baseTaskWhere: Prisma.TaskWhereInput;
  searchQuery?: string;
  rawReaderCoworkerId?: string | null;
}): Promise<Prisma.TaskFileWhereInput> {
  const { baseTaskWhere, searchQuery, rawReaderCoworkerId } = input;
  const trimmedSearch = searchQuery?.trim();
  if (!trimmedSearch) {
    return {
      ...DRIVE_TASK_FILE_WHERE,
      task: baseTaskWhere,
    };
  }

  // A hit inside a full audit's hidden `seo_audit` line is no hit.
  const [descriptionMatch] = await taskDescriptionMatches(
    [trimmedSearch],
    baseTaskWhere,
    { rawReaderCoworkerId },
  );
  return {
    ...DRIVE_TASK_FILE_WHERE,
    OR: [
      {
        name: { contains: trimmedSearch, mode: "insensitive" },
        task: baseTaskWhere,
      },
      {
        task: {
          AND: [
            baseTaskWhere,
            {
              OR: [
                { name: { contains: trimmedSearch, mode: "insensitive" } },
                descriptionMatch,
              ],
            },
          ],
        },
      },
    ],
  };
}

export async function fetchDriveTaskOutputRecentsBatch(input: {
  baseTaskWhere: Prisma.TaskWhereInput;
  cursor?: string;
  take: number;
  searchQuery?: string;
  rawReaderCoworkerId?: string | null;
}): Promise<{
  rows: DriveTaskOutputRecentsRow[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const { cursor, take } = input;
  const takePlusOne = take + 1;

  const taskFileWhere = await buildDriveTaskFileWhere(input);

  let effectiveCursor = cursor;
  if (cursor) {
    const cursorFile = await prisma.taskFile.findFirst({
      where: {
        id: cursor,
        ...taskFileWhere,
      },
      select: { id: true },
    });
    if (!cursorFile) {
      effectiveCursor = undefined;
    }
  }

  const matchingFiles = await prisma.taskFile.findMany({
    where: taskFileWhere,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: takePlusOne,
    ...(effectiveCursor ? { skip: 1, cursor: { id: effectiveCursor } } : {}),
    include: {
      task: {
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const hasMore = matchingFiles.length === takePlusOne;
  const pagedFiles = matchingFiles.slice(0, take);

  const rows: DriveTaskOutputRecentsRow[] = [];
  for (const file of pagedFiles) {
    if (!file.fileUrl) {
      continue;
    }
    rows.push({
      id: file.id,
      name: file.name,
      fileUrl: file.fileUrl,
      size: file.size === null ? null : Number(file.size),
      updatedAt: file.updatedAt,
      taskId: file.task.id,
      taskName: file.task.name,
      projectId: file.task.projectId,
      projectName: file.task.project?.name ?? null,
    });
  }

  return {
    rows,
    hasMore,
    nextCursor: hasMore
      ? (pagedFiles[pagedFiles.length - 1]?.id ?? null)
      : null,
  };
}
