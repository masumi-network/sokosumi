"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFileItem, DriveItem } from "@/lib/clients/generated/core";
import { getDriveFiles } from "@/lib/clients/generated/core";

/** Core max page size — fewer round trips than the default 20. */
export const DRIVE_FILES_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever. */
export const DRIVE_FILES_MAX_PAGES = 50;

export type DriveWorkspaceStore =
  | { scope: "me" }
  | { scope: "org"; organizationId: string };

export function driveStoreForActiveWorkspace(
  activeOrganizationId: string | null,
): DriveWorkspaceStore {
  if (activeOrganizationId) {
    return { scope: "org", organizationId: activeOrganizationId };
  }
  return { scope: "me" };
}

export function driveWorkspaceRootLabel(
  store: DriveWorkspaceStore,
  organizationName: string | null,
  labels: { myDrive: string; organizationFallback: string },
): string {
  if (store.scope === "org") {
    return organizationName || labels.organizationFallback;
  }
  return labels.myDrive;
}

type ListDriveFilesOptions = DriveWorkspaceStore & {
  q?: string;
  folder?: string;
  signal?: AbortSignal;
};

export async function listDriveFiles(
  options: ListDriveFilesOptions,
): Promise<DriveFileItem[]> {
  const items = await listDriveItems(options);
  return items.filter((item): item is DriveFileItem => item.type === "file");
}

export async function listDriveItems(
  options: ListDriveFilesOptions,
): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < DRIVE_FILES_MAX_PAGES; page += 1) {
    const response = await getDriveFiles({
      client: getBrowserCoreClient(),
      query: {
        scope: options.scope,
        limit: DRIVE_FILES_PAGE_LIMIT,
        ...(options.scope === "org"
          ? { organizationId: options.organizationId }
          : {}),
        ...(options.folder ? { folder: options.folder } : {}),
        ...(options.q?.trim() ? { q: options.q.trim() } : {}),
        ...(cursor ? { cursor } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
      throwOnError: true,
    });

    const allItems = response.data?.data ?? [];
    items.push(...allItems);

    const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;
    if (!nextCursor) {
      return items;
    }
    cursor = nextCursor;
  }

  return items;
}
