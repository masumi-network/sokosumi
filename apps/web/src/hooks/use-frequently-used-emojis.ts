"use client";

import { useSyncExternalStore } from "react";

import { recordFrequentlyUsedEmoji } from "@/lib/utils/emoji-shortcodes";

/**
 * The reader's emoji history, most recent first. The emoji picker's
 * "Frequently used" section and the message quick reactions read the same
 * per-browser list, so a pick in either place shows up in both.
 */
const FREQUENTLY_USED_STORAGE_KEY = "sokosumi.emoji-picker.recent.v1";
const NO_EMOJIS: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedEmojis: readonly string[] = NO_EMOJIS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(FREQUENTLY_USED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseEmojis(raw: string | null): readonly string[] {
  if (!raw) return NO_EMOJIS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_EMOJIS;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return NO_EMOJIS;
  }
}

/** Re-parses only when the stored string changes, so the snapshot stays referentially stable. */
function getSnapshot(): readonly string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEmojis = parseEmojis(raw);
  }
  return cachedEmojis;
}

function getServerSnapshot(): readonly string[] {
  return NO_EMOJIS;
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key === null || event.key === FREQUENTLY_USED_STORAGE_KEY) {
    notifyListeners();
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function useFrequentlyUsedEmojis(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function recordFrequentlyUsedEmojiPick(emoji: string): void {
  const next = recordFrequentlyUsedEmoji(getSnapshot(), emoji);
  try {
    localStorage.setItem(FREQUENTLY_USED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Incognito / blocked storage — ignore.
  }
  notifyListeners();
}
