"use client";

import type {
  DataRoom,
  DataRoomDetail,
  DataRoomEvents,
  DataRoomQuestion,
  UpdateDataRoomRequest,
} from "@sokosumi/core-client";
import {
  deleteDriveDataRoomsById,
  deleteDriveDataRoomsByIdMembersByMemberId,
  getDriveDataRooms,
  getDriveDataRoomsById,
  getDriveDataRoomsByIdEvents,
  getDriveDataRoomsByIdQuestions,
  patchDriveDataRoomsById,
  patchDriveDataRoomsByIdMembersByMemberId,
  patchDriveDataRoomsByIdQuestionsByQuestionId,
  postDriveDataRooms,
  postDriveDataRoomsByIdMembers,
  putDriveDataRoomsByIdOrder,
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

export async function fetchDataRoom(input: {
  store: FileStore;
  roomId: string;
}): Promise<DataRoomDetail> {
  const { data } = await getDriveDataRoomsById({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    query: storeQuery(input.store),
    throwOnError: true,
  });
  return data.data;
}

export type DataRoomSettings = Omit<
  UpdateDataRoomRequest,
  "scope" | "organizationId"
>;

export async function updateDataRoom(input: {
  store: FileStore;
  roomId: string;
  settings: DataRoomSettings;
}): Promise<DataRoom> {
  const { data } = await patchDriveDataRoomsById({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    body: { ...storeQuery(input.store), ...input.settings },
    throwOnError: true,
  });
  return data.data;
}

export async function inviteToDataRoom(input: {
  store: FileStore;
  roomId: string;
  emails: string[];
  expiresAt: string | null;
  folderPaths: string[];
}): Promise<void> {
  await postDriveDataRoomsByIdMembers({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    body: {
      ...storeQuery(input.store),
      emails: input.emails,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      folderPaths: input.folderPaths,
    },
    throwOnError: true,
  });
}

export async function updateDataRoomMember(input: {
  store: FileStore;
  roomId: string;
  memberId: string;
  expiresAt?: string | null;
  folderPaths?: string[];
}): Promise<void> {
  const { store, roomId, memberId, expiresAt, folderPaths } = input;
  await patchDriveDataRoomsByIdMembersByMemberId({
    client: getBrowserCoreClient(),
    path: { id: roomId, memberId },
    body: {
      ...storeQuery(store),
      ...(expiresAt !== undefined
        ? { expiresAt: expiresAt ? new Date(expiresAt) : null }
        : {}),
      ...(folderPaths ? { folderPaths } : {}),
    },
    throwOnError: true,
  });
}

export async function removeDataRoomMember(input: {
  store: FileStore;
  roomId: string;
  memberId: string;
}): Promise<void> {
  await deleteDriveDataRoomsByIdMembersByMemberId({
    client: getBrowserCoreClient(),
    path: { id: input.roomId, memberId: input.memberId },
    query: storeQuery(input.store),
    throwOnError: true,
  });
}

export async function fetchDataRoomEvents(input: {
  store: FileStore;
  roomId: string;
  memberId?: string;
  before?: string;
}): Promise<DataRoomEvents> {
  const { data } = await getDriveDataRoomsByIdEvents({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    query: {
      ...storeQuery(input.store),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.before ? { before: new Date(input.before) } : {}),
    },
    throwOnError: true,
  });
  return data.data;
}

export async function fetchDataRoomQuestions(input: {
  store: FileStore;
  roomId: string;
}): Promise<DataRoomQuestion[]> {
  const { data } = await getDriveDataRoomsByIdQuestions({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    query: storeQuery(input.store),
    throwOnError: true,
  });
  return data.data;
}

export async function answerDataRoomQuestion(input: {
  store: FileStore;
  roomId: string;
  questionId: string;
  answer: string;
}): Promise<void> {
  await patchDriveDataRoomsByIdQuestionsByQuestionId({
    client: getBrowserCoreClient(),
    path: { id: input.roomId, questionId: input.questionId },
    body: { ...storeQuery(input.store), answer: input.answer },
    throwOnError: true,
  });
}

export async function saveDataRoomOrder(input: {
  store: FileStore;
  roomId: string;
  entries: { path: string; position: number }[];
}): Promise<void> {
  await putDriveDataRoomsByIdOrder({
    client: getBrowserCoreClient(),
    path: { id: input.roomId },
    body: { ...storeQuery(input.store), entries: input.entries },
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
