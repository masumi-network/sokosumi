import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CoreApiRequestError } from "@/lib/clients/core.request";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { isUuidString } from "@/lib/utils/uuid";

import {
  type BackgroundChatReadPage,
  backgroundChatReadEnvelope,
  respondToBackgroundChatRead,
} from "../background-read";

const COLLECTIONS = ["active", "archived", "elsewhere", "invitations"] as const;
type Collection = (typeof COLLECTIONS)[number];

function isCollection(value: string): value is Collection {
  return (COLLECTIONS as readonly string[]).includes(value);
}

async function readCollection(
  collection: Collection,
): Promise<BackgroundChatReadPage> {
  if (collection === "invitations") {
    return { data: await chatRoomService.listPendingInvitations() };
  }
  if (collection === "elsewhere") {
    return { data: await chatRoomService.listElsewhereRooms() };
  }
  const page = await (collection === "active"
    ? chatRoomService.listRooms()
    : chatRoomService.listArchivedRooms());
  return {
    data: page.rooms,
    pagination: { nextCursor: page.nextCursor, limit: page.rooms.length },
  };
}

/** Marks a part whose read never reached Core, so the browser asks again. */
const STALLED_PART = { stalled: true } as const;

/**
 * Several collections behind one session read, each in its own envelope. A
 * collection whose Core read failed answers null, as its own request would
 * have. A throttle fails the whole answer, so every caller backs off. A read
 * that never reached Core answers `{ stalled: true }`: the browser asks for
 * that one again on its own, and that request gets the retries a 503 gets.
 * The other parts keep their rows.
 */
async function readCollections(
  collections: Collection[],
): Promise<BackgroundChatReadPage> {
  const settled = await Promise.allSettled(collections.map(readCollection));
  // A throttle wins over a stall, whichever answered first: only the
  // throttle sets the browser's shared backoff clock.
  const throttle = settled.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof CoreApiRequestError &&
      result.reason.status === 429,
  );
  if (throttle?.status === "rejected") {
    throw throttle.reason;
  }
  return {
    data: Object.fromEntries(
      collections.map((collection, index) => {
        const result = settled[index];
        if (result.status === "fulfilled") {
          return [collection, backgroundChatReadEnvelope(result.value)];
        }
        const stalled =
          result.reason instanceof CoreApiRequestError && !result.reason.status;
        return [collection, stalled ? STALLED_PART : null];
      }),
    ),
  };
}

/**
 * Background sidebar reads (see `respondToBackgroundChatRead`): one collection,
 * or with `roomId` the one room a message event named. A room the reader can
 * no longer open answers null, so the caller reads the whole list.
 * `collections` names several at once, so reads that start together cost one
 * session read instead of one each.
 */
export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId");
  if (roomId !== null) {
    if (!isUuidString(roomId)) {
      return NextResponse.json({ error: "Invalid room" }, { status: 400 });
    }
    return respondToBackgroundChatRead("Chat rooms unavailable", async () => ({
      data: await chatRoomService.getRoom(roomId),
    }));
  }

  const many = request.nextUrl.searchParams.get("collections");
  if (many !== null) {
    const collections = [...new Set(many.split(","))];
    if (!collections.every(isCollection)) {
      return NextResponse.json(
        { error: "Invalid collection" },
        { status: 400 },
      );
    }
    return respondToBackgroundChatRead("Chat rooms unavailable", () =>
      readCollections(collections),
    );
  }

  const collection = request.nextUrl.searchParams.get("collection");
  if (collection === null || !isCollection(collection)) {
    return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  }

  return respondToBackgroundChatRead("Chat rooms unavailable", () =>
    readCollection(collection),
  );
}
