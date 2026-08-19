"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFileItem } from "@/lib/clients/generated/core";
import { getDriveFiles } from "@/lib/clients/generated/core";

/** Core max page size — fewer round trips than the default 20. */
export const DRIVE_FILES_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever. */
export const DRIVE_FILES_MAX_PAGES = 50;

interface ListDriveFilesOptions {
  scope: "me" | "org";
  organizationId?: string;
  q?: string;
  folder?: string;
  signal?: AbortSignal;
}

export async function listDriveFiles(
  options: ListDriveFilesOptions,
): Promise<DriveFileItem[]> {
  const files: DriveFileItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < DRIVE_FILES_MAX_PAGES; page += 1) {
    const response = await getDriveFiles({
      client: getBrowserCoreClient(),
      query: {
        scope: options.scope,
        limit: DRIVE_FILES_PAGE_LIMIT,
        ...(options.scope === "org" && options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
        ...(options.folder ? { folder: options.folder } : {}),
        ...(options.q?.trim() ? { q: options.q.trim() } : {}),
        ...(cursor ? { cursor } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
      throwOnError: true,
    });

    // Filter to only files (exclude folders)
    const items = response.data?.data ?? [];
    const fileItems = items.filter(
      (item) => item.type === "file",
    ) as DriveFileItem[];
    files.push(...fileItems);

    const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;
    if (!nextCursor) {
      return files;
    }
    cursor = nextCursor;
  }

  return files;
}
