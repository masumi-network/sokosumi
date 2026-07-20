import { type RefObject, useCallback, useEffect } from "react";

import {
  listHermesMessagesAction,
  markHermesInboxSeenAction,
} from "@/lib/actions/hermes";
import { mergeHermesMessageLists } from "@/lib/hermes/merge-persisted-messages";

import { POLL_INTERVAL_MS } from "./constants";
import { hasSameMessageIds, persistedToMessage } from "./message-helpers";
import type { Message } from "./types";

interface UseHermesInboxSyncOptions {
  previewMode: boolean;
  isReplyingRef: RefObject<boolean>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function useHermesInboxSync({
  previewMode,
  isReplyingRef,
  setMessages,
}: UseHermesInboxSyncOptions) {
  const syncMessages = useCallback(async () => {
    if (isReplyingRef.current) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const result = await listHermesMessagesAction({});
    if (!result.ok || isReplyingRef.current) return;
    const next = result.data
      .map(persistedToMessage)
      .filter((m): m is Message => m !== null);
    const latest = next[next.length - 1];
    if (latest) {
      void markHermesInboxSeenAction({ asOfIso: latest.createdAt });
    }
    setMessages((prev) => {
      const merged = mergeHermesMessageLists(prev, next);
      return hasSameMessageIds(prev, merged) ? prev : merged;
    });
  }, [isReplyingRef, setMessages]);

  // Browser-side polling for outbox messages (scheduled tasks, reminders,
  // agent-initiated follow-ups). Server cron drains the orchestrator into
  // our DB; this loop just keeps the open tab in sync so the user doesn't
  // have to reload. Paused while a chat turn is mid-flight (so optimistic
  // bubbles don't flicker) and while the tab is hidden.
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (isReplyingRef.current) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const result = await listHermesMessagesAction({});
      if (cancelled || !result.ok) return;
      // Re-check after the await: if the user kicked off a chat turn while we
      // were fetching, the server's snapshot is now stale relative to our
      // optimistic local state. Discarding here prevents clobbering the
      // user's just-typed bubble. (Same race fixed in sendMessage by setting
      // isReplyingRef synchronously before any awaits.)
      if (isReplyingRef.current) return;
      const next = result.data
        .map(persistedToMessage)
        .filter((m): m is Message => m !== null);

      // Mark inbox as seen up to the latest message we have. The user is
      // actively viewing the chat, so anything we just rendered should clear
      // the sidebar badge. Best-effort — failures don't break rendering.
      const latest = next[next.length - 1];
      if (latest) {
        void markHermesInboxSeenAction({ asOfIso: latest.createdAt });
      }

      setMessages((prev) => {
        const merged = mergeHermesMessageLists(prev, next);
        // Cheap shallow check to avoid unnecessary rerenders + scroll jitter.
        if (hasSameMessageIds(prev, merged)) return prev;
        return merged;
      });
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isReplyingRef, previewMode, setMessages]);

  // Mark inbox as seen when the user lands on /personal-assistant — clears the sidebar
  // unread badge for whatever was waiting on initial load.
  useEffect(() => {
    if (previewMode) return;
    void markHermesInboxSeenAction({});
  }, [previewMode]);

  return { syncMessages };
}
