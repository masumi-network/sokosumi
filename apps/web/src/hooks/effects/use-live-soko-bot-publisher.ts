"use client";

import { useLayoutEffect } from "react";
import { publishLiveSokoBot } from "@/components/chat/personal-assistant-chrome-store";
import type { LiveSokoBotFields } from "@/hooks/effects/use-live-soko-bot-poll";

/**
 * Publishes your Soko Bot's live status before paint (`useLayoutEffect`) so
 * the chat list's Direct row updates in the same frame as the sidebar Soko
 * Bot row.
 */
export function useLiveSokoBotPublisher(
  bot: LiveSokoBotFields & { id: string },
): void {
  const { id, status, lastActivityAt } = bot;
  const lastActivityTime = lastActivityAt?.getTime() ?? null;
  useLayoutEffect(
    () =>
      publishLiveSokoBot({
        id,
        status,
        lastActivityAt:
          lastActivityTime === null ? null : new Date(lastActivityTime),
      }),
    [id, status, lastActivityTime],
  );
}
