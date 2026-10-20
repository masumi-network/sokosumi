"use client";

import { createContext, useContext } from "react";

/**
 * The shared bot a console manages, or null for the caller's own bot. The
 * console provides it once, so every panel's action reaches the same bot.
 */
export const SokoBotTargetContext = createContext<string | null>(null);

/** The `botId` a console panel passes to its actions and route handlers. */
export function useSokoBotTargetId(): string | undefined {
  return useContext(SokoBotTargetContext) ?? undefined;
}
