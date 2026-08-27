import type { Prisma } from "@sokosumi/database";

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

export async function fetchDriveTaskOutputRecentsBatch(input: {
  baseTaskWhere: Prisma.TaskWhereInput;
  cursor?: string;
  take: number;
}): Promise<{
  rows: DriveTaskOutputRecentsRow[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const { baseTaskWhere, cursor, take } = input;
  const takePlusOne = take + 1;

  const taskFileWhere: Prisma.TaskFileWhereInput = {
    ...DRIVE_TASK_FILE_WHERE,
    task: baseTaskWhere,
  };

  if (cursor) {
    const cursorFile = await prisma.taskFile.findFirst({
      where: {
        id: cursor,
        ...taskFileWhere,
      },
      select: { id: true },
    });
    if (!cursorFile) {
      return { rows: [], hasMore: false, nextCursor: null };
    }
  }

  const matchingFiles = await prisma.taskFile.findMany({
    where: taskFileWhere,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: takePlusOne,
    skip: cursor ? 1 : undefined,
    cursor: cursor ? { id: cursor } : undefined,
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
      size: file.size ? Number(file.size) : null,
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
