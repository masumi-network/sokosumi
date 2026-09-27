"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  parseChatUnreadsFilterCookieHeader,
  serializeChatUnreadsFilterCookie,
} from "@/lib/ui-preferences/chat-unreads-filter";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return parseChatUnreadsFilterCookieHeader(document.cookie);
}

/** The prerendered shell cannot read cookies, so it always draws All. */
function getServerSnapshot() {
  return false;
}

function setChatUnreadsFilter(on: boolean) {
  document.cookie = serializeChatUnreadsFilterCookie(on);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * The Unreads filter, remembered per browser. Every mounted chat list — the
 * sidebar and the phone's Chats page — reads and writes the one value.
 */
export function useChatUnreadsFilter(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Drop the mark only once the cookie is off. Dropping it when this list
  // agrees unhides every other All list still on the page: the sidebar and
  // the phone's Chats page both mount, and one can hydrate before the other
  // streams in. While the cookie is on, the mark keeps those All lists
  // hidden. Switching off clears it before paint, including a mark this page
  // set before another tab turned the filter off.
  useLayoutEffect(() => {
    if (on || getSnapshot()) {
      return;
    }
    document.documentElement.removeAttribute(
      CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
    );
  }, [on]);
  return [on, setChatUnreadsFilter];
}
