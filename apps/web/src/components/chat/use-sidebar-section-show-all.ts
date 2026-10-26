"use client";

import { useSyncExternalStore } from "react";

import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

export type SidebarRoomSection = "channels" | "external" | "direct";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function storageKey(section: SidebarRoomSection) {
  return `sokosumi:chat-sidebar-show-all:${section}:v1`;
}

function readShowAll(section: SidebarRoomSection): boolean {
  return (
    readStoredPreference(storageKey(section), (raw) =>
      raw === "true" ? true : raw === "false" ? false : null,
    ) ?? false
  );
}

/** The prerendered shell has no storage, so it always draws the short list. */
function getServerSnapshot() {
  return false;
}

/**
 * Whether a sidebar section lists every room or stops at the limit,
 * remembered per browser and section. The sidebar and the phone's Chats page
 * both mount the list, and both read and write the one value.
 */
export function useSidebarSectionShowAll(
  section: SidebarRoomSection,
): [boolean, (showAll: boolean) => void] {
  const showAll = useSyncExternalStore(
    subscribe,
    () => readShowAll(section),
    getServerSnapshot,
  );
  function setShowAll(next: boolean) {
    writeStoredPreference(storageKey(section), String(next));
    for (const listener of listeners) {
      listener();
    }
  }
  return [showAll, setShowAll];
}
