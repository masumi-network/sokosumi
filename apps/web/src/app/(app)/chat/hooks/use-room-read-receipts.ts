"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { ChatRoomReadEventData } from "@/lib/ably/schema";
import type {
  ChatRoom,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

/** One member of the Room roster and when they last read the room. */
export interface RoomReader {
  participant: ChatRoomUserParticipant;
  lastReadAt: Date;
}

export interface RoomReadReceipts {
  /**
   * Roster humans who have read the room, most-recent-read first. The viewer
   * is already out: posting advances the sender's own Room last-read, so
   * keeping them would add one to every count.
   */
  readers: readonly RoomReader[];
  /** Roster humans with no Room last-read at all, by display order. */
  nonReaders: readonly ChatRoomUserParticipant[];
  /**
   * The readers whose mark had reached `at`, most-recent-read first — the
   * faces the transcript shows under a message.
   */
  readersAsOf: (at: Date | string) => readonly RoomReader[];
  /**
   * What one roster row should say about a member.
   *
   * Null where the question does not apply and the row must stay silent: the
   * viewer themselves (posting advances their own mark, so it would say
   * nothing they do not know), anyone off the human roster — a Coworker or a
   * Soko Bot has no read state and none is invented for them — and every
   * member when the viewer is a guest.
   */
  readStateFor: (userId: string) => RoomMemberReadState | null;
}

export type RoomMemberReadState =
  | { kind: "read"; lastReadAt: Date }
  | { kind: "unread" };

const NO_READERS: RoomReadReceipts = {
  readers: [],
  nonReaders: [],
  readersAsOf: () => [],
  readStateFor: () => null,
};

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Room read receipts for the open room: the room payload's per-member Room
 * last-read, with live read events applied on top.
 *
 * The payload is the floor and the events are the ceiling. A dropped realtime
 * connection leaves the last values it delivered standing rather than emptying
 * the stack, and the next room payload heals it without a reload. An event
 * that would rewind a member's mark is dropped, so events arriving out of
 * order cannot un-read a room.
 *
 * Coworkers and Soko Bots are not here at all: receipts count people.
 */
export function useRoomReadReceipts({
  room,
  currentUserId,
}: {
  room: ChatRoom | null;
  currentUserId: string;
}): RoomReadReceipts & {
  /** Feed one incoming read event; ignores other rooms and non-members. */
  applyReadEvent: (event: ChatRoomReadEventData) => void;
} {
  const [liveReads, setLiveReads] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  // Read times do not cross the organization boundary. Core keeps them out of
  // the payload for a guest and off the wire for a room with one on it; this is
  // the last of the three, so a guest client that somehow met an event still
  // shows nothing.
  const isGuestViewer = room?.myAccess === "guest";
  const isGuestViewerRef = useRef(isGuestViewer);
  isGuestViewerRef.current = isGuestViewer;
  const roomIdRef = useRef(room?.id ?? null);
  // A new room starts from its own payload; the previous room's events say
  // nothing about it.
  if (roomIdRef.current !== (room?.id ?? null)) {
    roomIdRef.current = room?.id ?? null;
    if (liveReads.size > 0) {
      setLiveReads(new Map());
    }
  }

  const applyReadEvent = useCallback((event: ChatRoomReadEventData) => {
    if (isGuestViewerRef.current || event.roomId !== roomIdRef.current) {
      return;
    }
    const at = toTime(event.lastReadAt);
    if (Number.isNaN(at)) {
      return;
    }
    setLiveReads((current) => {
      const known = current.get(event.userId);
      if (known != null && known >= at) {
        return current;
      }
      const next = new Map(current);
      next.set(event.userId, at);
      return next;
    });
  }, []);

  const receipts = useMemo<RoomReadReceipts>(() => {
    if (!room) {
      return NO_READERS;
    }

    const readers: RoomReader[] = [];
    const nonReaders: ChatRoomUserParticipant[] = [];

    for (const participant of room.userMembers) {
      if (participant.id === currentUserId) {
        continue;
      }
      if (isGuestViewer) {
        nonReaders.push(participant);
        continue;
      }
      const seeded = participant.lastReadAt
        ? toTime(participant.lastReadAt)
        : null;
      const live = liveReads.get(participant.id) ?? null;
      const at =
        seeded == null ? live : live == null ? seeded : Math.max(seeded, live);
      if (at == null) {
        nonReaders.push(participant);
        continue;
      }
      readers.push({ participant, lastReadAt: new Date(at) });
    }

    readers.sort((a, b) => b.lastReadAt.getTime() - a.lastReadAt.getTime());

    // A guest is told nothing either way. Everyone lands in `nonReaders` for
    // them, which is what empties the stack — but "not read yet" about a host
    // member is still a read time, so the rows must stay silent rather than
    // report the whole room unread.
    const readStateByUserId = new Map<string, RoomMemberReadState>();
    if (!isGuestViewer) {
      for (const reader of readers) {
        readStateByUserId.set(reader.participant.id, {
          kind: "read",
          lastReadAt: reader.lastReadAt,
        });
      }
      for (const participant of nonReaders) {
        readStateByUserId.set(participant.id, { kind: "unread" });
      }
    }

    return {
      readers,
      nonReaders,
      readStateFor: (userId) => readStateByUserId.get(userId) ?? null,
      readersAsOf: (at) => {
        const moment = toTime(at);
        if (Number.isNaN(moment)) {
          return [];
        }
        return readers.filter(
          (reader) => reader.lastReadAt.getTime() >= moment,
        );
      },
    };
  }, [room, currentUserId, liveReads, isGuestViewer]);

  return { ...receipts, applyReadEvent };
}
