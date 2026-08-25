"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveTasksListItem } from "@/lib/clients/generated/core";
import { getDriveTasks } from "@/lib/clients/generated/core";

/** Core max page size for task items. */
export const DRIVE_TASKS_PAGE_LIMIT = 100;

export interface DriveTasksPageResult {
  items: DriveTasksListItem[];
  nextCursor: string | null;
}

export interface FetchDriveTasksPageOptions {
  scope: "me" | "org";
  organizationId?: string;
  projectId?: string | "null";
  taskId?: string;
  assigneeId?: string;
  q?: string;
  cursor?: string;
  signal?: AbortSignal;
}

export async function fetchDriveTasksPage(
  options: FetchDriveTasksPageOptions,
): Promise<DriveTasksPageResult> {
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
      ...(options.q ? { q: options.q } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
    throwOnError: true,
  });

  const items = (response.data?.data ?? []).map(coerceDriveTasksListItemDates);
  const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;

  return {
    items,
    nextCursor: nextCursor && nextCursor === options.cursor ? null : nextCursor,
  };
}

function coerceDriveTasksListItemDates(
  item: DriveTasksListItem,
): DriveTasksListItem {
  if (item.type === "task-file") {
    return {
      ...item,
      updatedAt: new Date(item.updatedAt),
    };
  }
  return {
    ...item,
    latestFileUpdatedAt: new Date(item.latestFileUpdatedAt),
  };
}
