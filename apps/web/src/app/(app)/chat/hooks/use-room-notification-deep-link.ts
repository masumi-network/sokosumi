"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { useRef } from "react";

import { getRoomMessageAction } from "@/app/chat/message-actions";
import { pathWithSearch } from "@/app/chat/utils/chat-route-base";
import {
  performRoomNotificationJump,
  type RoomNotificationLookup,
} from "@/app/chat/utils/room-notification-jump";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";

import { useMessageParamJump } from "./use-message-param-jump";

export interface RoomNotificationDeepLinkParams {
  /** The room on screen, or null before one is selected. */
  roomId: string | null;
  /**
   * The room's messages have loaded. Highlighting reads the DOM, so the first
   * page has to be on screen before a jump can find anything to highlight.
   */
  ready: boolean;
  pathname: string;
  searchParams: ReadonlyURLSearchParams;
  replace: (href: string, options: { scroll: false }) => void;
  /** True when the message is already in the room transcript. Saves the lookup. */
  highlight: (messageId: string) => boolean;
  /** Still the room this jump was started for. */
  isStillSelectedRoom: (roomId: string) => boolean;
  invalidateJump: () => void;
  /** Resolves true once the message is on screen; not read here. */
  jumpInRoom: (messageId: string) => Promise<boolean>;
  jumpInThread: (message: ChatRoomMessage) => Promise<void>;
}

/**
 * Open the message a chat notification named, from the room's own URL.
 *
 * A notification arrives with a message id and nothing else. It may name a
 * message in the room timeline or a reply that only exists inside a thread,
 * so the message is read before the jump is chosen.
 *
 * Extracted from the room client rather than written inside it: the wiring
 * between the URL, the read and the two jumps is where this feature can go
 * wrong, and it is worth being able to see and test on its own.
 */
export function useRoomNotificationDeepLink({
  roomId,
  ready,
  pathname,
  searchParams,
  replace,
  highlight,
  isStillSelectedRoom,
  invalidateJump,
  jumpInRoom,
  jumpInThread,
}: RoomNotificationDeepLinkParams): void {
  const latestJumpRef = useRef(new Map<string, string>());

  async function jumpToNotificationMessage(messageId: string): Promise<void> {
    if (!roomId) {
      return;
    }

    // A reader clearing a list of notifications can click a second one for
    // this same room while the first is still being read. Both reads are then
    // in flight, and the order they come back in is the server's to decide,
    // so without this the message that lands is whichever request was slower
    // rather than the one the reader asked for last. The room guards below
    // cannot see it: both jumps carry the same room.
    //
    // Held per room rather than as one counter. A jump started for another
    // room says nothing about this one, and a reader who goes on to a second
    // room and comes back is still owed the message they first asked for. One
    // slot for the last room would not do: two jumps for this room and a
    // third for another would leave both of the first two calling themselves
    // newest.
    invalidateJump();
    latestJumpRef.current.set(roomId, messageId);
    const isNewestJump = () => latestJumpRef.current.get(roomId) === messageId;

    await performRoomNotificationJump(messageId, {
      highlight,
      loadMessage: async (id): Promise<RoomNotificationLookup> => {
        const result = await getRoomMessageAction(roomId, id);
        // The reader can click a second notification while this one is still
        // loading. Answering for a room they have left would open a thread
        // from the old room over the new one.
        if (!isStillSelectedRoom(roomId)) {
          return { status: "notReadable" };
        }
        if (!result.ok) {
          return { status: "unavailable" };
        }
        // Core refuses a message the reader cannot read: 404 when the room
        // is archived, when they are not a member of it, or when the id names
        // nothing in it, and 403 when they are no longer a member of the
        // organization behind it. The service reads both as no message rather
        // than as a failure. A soft delete is not one of them; it comes back
        // as a tombstone.
        return result.value
          ? { status: "found", message: result.value }
          : { status: "notReadable" };
      },
      // Guarded rather than the lookup, which answers honestly either way.
      // Only the jump itself has to be held back, and holding it here covers
      // the jump a failed lookup falls back to as well.
      jumpInRoom: async (id) => {
        if (!isNewestJump()) {
          return;
        }
        await jumpInRoom(id);
      },
      jumpInThread: async (message) => {
        if (!isNewestJump()) {
          return;
        }
        await jumpInThread(message);
      },
    });
  }

  useMessageParamJump({
    roomId,
    // Trimmed like the href builder trims it, so a hand-typed blank names
    // nothing here either.
    messageId: searchParams.get(CHAT_MESSAGE_PARAM)?.trim() || null,
    ready,
    jump: (messageId) => {
      // Spend the message from the URL as soon as it is acted on. Left there,
      // every Back into this history entry would jump again and drag a reader
      // who had scrolled away back to a message they have already read.
      const remaining = new URLSearchParams(searchParams);
      remaining.delete(CHAT_MESSAGE_PARAM);
      replace(pathWithSearch(pathname, remaining), { scroll: false });
      // Nothing awaits this, so a transport failure would otherwise surface as
      // an unhandled rejection on room open rather than on a click.
      jumpToNotificationMessage(messageId).catch((error) => {
        console.error("Failed to open the message a notification named", error);
      });
    },
  });
}
