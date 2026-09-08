"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  CHAT_EDIT_CHANNEL_PARAM,
  chatRoomHref,
  pathWithoutOneShotRoomParams,
} from "@/app/chat/utils/chat-route-base";

export interface EditChannelParamParams {
  /** The room on screen, or null before one is selected. */
  roomId: string | null;
  /**
   * The roster has landed. The dialog reads the org roster for its member
   * picker, and the reader's own role in it decides what the dialog lets them
   * change. Opening before that shows a smaller dialog that then grows.
   */
  ready: boolean;
  pathname: string;
  searchParams: ReadonlyURLSearchParams;
  replace: (href: string, options: { scroll: false }) => void;
  /** Open the room's edit dialog. */
  open: () => void;
}

/**
 * Open the edit dialog the URL asks for, once per arrival at it.
 *
 * A channel row's overflow menu cannot open the dialog where it stands: the
 * app sidebar holds the room and nothing else, while the dialog needs the org
 * roster and the reader's role. So the row sends the reader here and asks on
 * the URL, and the room, which has all of it already, opens the dialog.
 *
 * The parameter is taken back off the URL as soon as it is read. It is a
 * request, not a state: a reader who closes the dialog and reloads is not
 * asking for it again, and a reader who picks Edit a second time is.
 */
export function useEditChannelParam({
  roomId,
  ready,
  pathname,
  searchParams,
  replace,
  open,
}: EditChannelParamParams): void {
  const openedRoomRef = useRef<string | null>(null);
  const asked = searchParams.get(CHAT_EDIT_CHANNEL_PARAM) != null;

  useEffect(() => {
    // Nothing asked for. Whatever was opened is behind the reader, so the
    // next ask counts as new — including a second ask for the same room.
    if (!asked) {
      openedRoomRef.current = null;
      return;
    }

    // The strip below only lands on the next render, so without the ref the
    // renders in between would each open and replace again.
    if (!roomId || !ready || openedRoomRef.current === roomId) {
      return;
    }

    // The URL and the room on screen have to name the same room. The room
    // client stays mounted across rooms, so a reader asking for a channel
    // they are not in is asking about a room this component does not hold
    // yet, and the dialog it would open is the one they are leaving.
    if (pathname !== chatRoomHref(roomId)) {
      return;
    }

    openedRoomRef.current = roomId;
    replace(pathWithoutOneShotRoomParams(pathname, searchParams), {
      scroll: false,
    });
    open();
  }, [asked, roomId, ready, searchParams, pathname, replace, open]);
}
