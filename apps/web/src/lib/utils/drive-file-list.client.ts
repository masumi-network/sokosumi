"use client";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveFile } from "@/lib/clients/generated/core";
import { getDriveFiles } from "@/lib/clients/generated/core";

/** Core max page size — fewer round trips than the default 20. */
export const DRIVE_FILES_PAGE_LIMIT = 100;
/** Hard stop so a bad nextCursor cannot loop forever. */
export const DRIVE_FILES_MAX_PAGES = 50;

interface ListDriveFilesOptions {
  scope: "me" | "org";
  organizationId?: string;
}

function driveFilesListErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }
  return "Failed to load files";
}

export async function listDriveFiles(
  options: ListDriveFilesOptions,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
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
        ...(cursor ? { cursor } : {}),
      },
      throwOnError: true,
    });

    if (response.error) {
      throw new Error(driveFilesListErrorMessage(response.error));
    }

    files.push(...(response.data?.data ?? []));

    const nextCursor = response.data?.meta?.pagination?.nextCursor ?? null;
    if (!nextCursor) {
      return files;
    }
    cursor = nextCursor;
  }

  return files;
}
