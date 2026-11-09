"use client";

import type { DataRoom } from "@sokosumi/core-client";
import {
  deleteDriveDataRoomsById,
  getDriveDataRooms,
  postDriveDataRooms,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { type FileStore, storeQuery } from "@/lib/utils/file-search.client";

/** Browser calls for data rooms: Drive folders whose files are private. */

export async function fetchDataRooms(store: FileStore): Promise<DataRoom[]> {
  const { data } = await getDriveDataRooms({
    client: getBrowserCoreClient(),
    query: storeQuery(store),
    throwOnError: true,
  });
  return data.data;
}

export async function createDataRoom(input: {
  store: FileStore;
  folderPath: string;
}): Promise<DataRoom> {
  const { data } = await postDriveDataRooms({
    client: getBrowserCoreClient(),
    body: { ...storeQuery(input.store), folderPath: input.folderPath },
    throwOnError: true,
  });
  return data.data;
}

export async function closeDataRoom(input: {
  store: FileStore;
  roomId: string;
}): Promise<void> {
  await deleteDriveDataRoomsById({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    query: storeQuery(input.store),
    throwOnError: true,
  });
}

/**
 * Core's own words for a refusal ("This folder holds a data room…"), which
 * are written for the person; null when the failure carried none.
 */
export function dataRoomRefusal(error: unknown): string | null {
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

/** The room a folder is, or sits inside, if any. */
export function dataRoomOf(
  rooms: readonly DataRoom[],
  folderPath: string,
): DataRoom | undefined {
  return rooms.find(
    (room) =>
      folderPath === room.folderPath ||
      folderPath.startsWith(`${room.folderPath}/`),
  );
}
