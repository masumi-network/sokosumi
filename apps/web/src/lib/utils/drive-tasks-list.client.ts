"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveTasksListItem } from "@/lib/clients/generated/core";
import { getDriveTasks } from "@/lib/clients/generated/core";
import type {
  TaskFileItem,
  TaskItem,
  TaskNoProjectItem,
  TaskProjectItem,
} from "@/lib/types/drive-explore-item";

/** Core max page size for task items. */
export const DRIVE_TASKS_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever. */
export const DRIVE_TASKS_MAX_PAGES = 50;

interface ListDriveTasksOptions {
  scope: "me" | "org";
  organizationId?: string;
  projectId?: string | "null";
  taskId?: string;
  assigneeId?: string;
  signal?: AbortSignal;
}

export async function listDriveTasks(
  options: ListDriveTasksOptions,
): Promise<
  Array<TaskProjectItem | TaskNoProjectItem | TaskItem | TaskFileItem>
> {
  const items: DriveTasksListItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < DRIVE_TASKS_MAX_PAGES; page += 1) {
    const response = await getDriveTasks({
      client: getBrowserCoreClient(),
      query: {
        scope: options.scope,
        limit: DRIVE_TASKS_PAGE_LIMIT,
        ...(options.scope === "org" && options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
        ...(options.projectId !== undefined
          ? { projectId: options.projectId }
          : {}),
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.assigneeId ? { assigneeId: options.assigneeId } : {}),
        ...(cursor ? { cursor } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
      throwOnError: true,
    });

    const allItems = response.data?.data ?? [];
    items.push(...allItems);

    const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  return items.map(mapTasksListItemToExploreItem);
}

function mapTasksListItemToExploreItem(
  item: DriveTasksListItem,
): TaskProjectItem | TaskNoProjectItem | TaskItem | TaskFileItem {
  switch (item.type) {
    case "project":
      return {
        type: "task-project",
        id: item.id,
        name: item.name,
        latestFileUpdatedAt: item.latestFileUpdatedAt.toISOString(),
      };
    case "no-project":
      return {
        type: "task-no-project",
        id: "null",
        latestFileUpdatedAt: item.latestFileUpdatedAt.toISOString(),
      };
    case "task":
      return {
        type: "task",
        id: item.id,
        name: item.name,
        latestFileUpdatedAt: item.latestFileUpdatedAt.toISOString(),
      };
    case "task-file":
      return {
        type: "task-file",
        id: item.id,
        name: item.name,
        fileUrl: item.fileUrl,
        size: item.size,
        mimeType: item.mimeType,
        updatedAt: item.updatedAt.toISOString(),
      };
  }
}
