"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveRecentsItem } from "@/lib/clients/generated/core";
import { getDriveRecents } from "@/lib/clients/generated/core";
import type { FilesSortBy, FilesSortOrder } from "@/lib/utils/files-sort";

export const DRIVE_RECENTS_PAGE_LIMIT = 50;

export interface DriveRecentsPageResult {
  items: DriveRecentsItem[];
  nextCursor: string | null;
}

export interface FetchDriveRecentsPageOptions {
  scope: "me" | "org";
  organizationId?: string;
  cursor?: string;
  q?: string;
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
  signal?: AbortSignal;
}

export async function fetchDriveRecentsPage(
  options: FetchDriveRecentsPageOptions,
): Promise<DriveRecentsPageResult> {
  const response = await getDriveRecents({
    client: getBrowserCoreClient(),
    query: {
      scope: options.scope,
      limit: DRIVE_RECENTS_PAGE_LIMIT,
      ...(options.scope === "org" && options.organizationId
        ? { organizationId: options.organizationId }
        : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.q?.trim() ? { q: options.q.trim() } : {}),
      ...(options.sortBy ? { sortBy: options.sortBy } : {}),
      ...(options.sortOrder ? { sortOrder: options.sortOrder } : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
    throwOnError: true,
  });

  const items = (response.data?.data ?? []).map(coerceDriveRecentsItemDates);
  const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;

  return {
    items,
    nextCursor: nextCursor && nextCursor === options.cursor ? null : nextCursor,
  };
}

function coerceDriveRecentsItemDates(item: DriveRecentsItem): DriveRecentsItem {
  return {
    ...item,
    activityAt: new Date(item.activityAt),
  };
}
