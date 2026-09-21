"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { ChatRoomReadEventData } from "@/lib/ably";
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
  /** How many readers had read as of `at` — the transcript's Seen by N. */
  countReadAsOf: (at: Date | string) => number;
}

const NO_READERS: RoomReadReceipts = {
  readers: [],
  nonReaders: [],
  countReadAsOf: () => 0,
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
    if (event.roomId !== roomIdRef.current) {
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

    return {
      readers,
      nonReaders,
      countReadAsOf: (at) => {
        const moment = toTime(at);
        if (Number.isNaN(moment)) {
          return 0;
        }
        return readers.filter((reader) => reader.lastReadAt.getTime() >= moment)
          .length;
      },
    };
  }, [room, currentUserId, liveReads]);

  return { ...receipts, applyReadEvent };
}
