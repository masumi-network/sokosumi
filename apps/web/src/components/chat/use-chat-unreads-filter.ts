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
  // The boot mark stands in for the cookie only until React renders it: the
  // hydration pass still renders the server's All, so it waits for the render
  // that agrees with the cookie. Left behind, it would hide All for good.
  useLayoutEffect(() => {
    if (on === getSnapshot()) {
      document.documentElement.removeAttribute(
        CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
      );
    }
  }, [on]);
  return [on, setChatUnreadsFilter];
}
