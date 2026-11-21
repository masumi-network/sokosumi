"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A name for "this first message", stable across every retry of it.
 *
 * Without one, a create whose response never arrives leaves the browser with
 * no session id at all, and the next attempt starts a second conversation
 * saying the same thing. It is stored rather than held in memory so a reload
 * mid-attempt is still the same attempt, and it is dropped the moment a
 * session exists, because from then on the session id is the identity.
 */
function intentStorageKey(projectId: string): string {
  return `sokosumi:image-studio:intent:${projectId}`;
}

/**
 * The attempt, and what it was an attempt to say.
 *
 * The name alone was not enough. Reused for a *different* message it means
 * "create-once for this conversation", which is exactly right for a replay and
 * exactly wrong for an edit: the agent answers with the conversation the first
 * attempt created and dispatches nothing, and the edited message disappears
 * without a word. Keeping what the attempt said is what lets the two be told
 * apart.
 */
export interface StudioIntent {
  id: string;
  /** The message and selection this attempt was for. */
  says: string;
}

function readIntent(projectId: string): StudioIntent | null {
  try {
    const raw = window.sessionStorage.getItem(intentStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioIntent>;
    if (typeof parsed.id !== "string" || typeof parsed.says !== "string")
      return null;
    // Older intents also recorded generation options. Keep retries of the
    // same message about the same asset under the original attempt's name.
    const parts: unknown = JSON.parse(parsed.says);
    return Array.isArray(parts) && parts.length >= 2
      ? { id: parsed.id, says: JSON.stringify(parts.slice(0, 2)) }
      : null;
  } catch {
    // No stored attempt; this page load starts its own.
    return null;
  }
}

function newIntentId(): string {
  try {
    return window.crypto.randomUUID();
  } catch {
    // Insecure context or no WebCrypto: still unique enough to dedupe one
    // person's retries of one message, which is all this has to do.
    return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Restores, claims, and releases the `sessionStorage`-backed first-message
 * intent for `StudioConversation`.
 */
export function useStudioChatIntent(
  projectId: string,
  resumeSessionId: string | null,
) {
  /**
   * The attempt this client is making, while it still has no session id to
   * identify the conversation by. Read fresh on every request through the
   * `headers` resolver, so it needs no rerender to take effect.
   */
  const intentRef = useRef<StudioIntent | null>(null);

  // Pick up an attempt that was in flight when the page went away, so a reload
  // mid-create is still the same attempt rather than a second conversation.
  useEffect(() => {
    if (resumeSessionId) return;
    intentRef.current = readIntent(projectId);
  }, [projectId, resumeSessionId]);

  /**
   * Name this attempt, once, and keep the name until a session exists.
   *
   * Called before the first submit rather than on mount: a conversation nobody
   * has spoken into has no attempt to identify.
   */
  const claimIntent = useCallback(
    (says: string) => {
      if (intentRef.current) return;
      const intent = { id: newIntentId(), says };
      intentRef.current = intent;
      try {
        window.sessionStorage.setItem(
          intentStorageKey(projectId),
          JSON.stringify(intent),
        );
      } catch {
        // Memory-only is still enough for a same-page retry.
      }
    },
    [projectId],
  );

  /** The session id is the identity from here on; the intent has done its job. */
  const releaseIntent = useCallback(() => {
    if (!intentRef.current) return;
    intentRef.current = null;
    try {
      window.sessionStorage.removeItem(intentStorageKey(projectId));
    } catch {
      // Nothing depends on the removal succeeding.
    }
  }, [projectId]);

  return { intentRef, claimIntent, releaseIntent };
}
