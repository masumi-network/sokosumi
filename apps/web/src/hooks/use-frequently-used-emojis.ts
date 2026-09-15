"use client";

import { useSyncExternalStore } from "react";

import {
  appendEmojiUse,
  rankFrequentlyUsedEmojis,
} from "@/lib/utils/emoji-shortcodes";

/**
 * The reader's emoji use log, newest first, stored per browser. The emoji
 * picker's "Frequently used" section and the message quick reactions both
 * read its ranking, so a use anywhere shows up in both. The picker only
 * reads; whoever consumes a pick (reaction, composer) calls
 * {@link recordEmojiUse} once.
 */
const FREQUENTLY_USED_STORAGE_KEY = "sokosumi.emoji-picker.recent.v1";
const NO_EMOJIS: readonly string[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedLog: readonly string[] = NO_EMOJIS;
let cachedRanking: readonly string[] = NO_EMOJIS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(FREQUENTLY_USED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseLog(raw: string | null): readonly string[] {
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
function syncCache(): void {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLog = parseLog(raw);
    cachedRanking = rankFrequentlyUsedEmojis(cachedLog);
  }
}

function getSnapshot(): readonly string[] {
  syncCache();
  return cachedRanking;
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

/** Distinct emojis, most used first. */
export function useFrequentlyUsedEmojis(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function recordEmojiUse(emoji: string): void {
  syncCache();
  const next = appendEmojiUse(cachedLog, emoji);
  try {
    localStorage.setItem(FREQUENTLY_USED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Incognito / blocked storage — ignore.
  }
  notifyListeners();
}
