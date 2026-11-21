"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Restores and persists the Image Studio conversation draft in `sessionStorage`
 * per project, keeping a live ref so failed-message recovery never overwrites
 * newer text across a recovery remount.
 */
export function useStudioChatDraft(projectId: string) {
  const draftKey = `sokosumi:image-studio:draft:${projectId}`;
  const [draft, setDraft] = useState("");
  /**
   * What is in the composer right now.
   *
   * Read by the failure path instead of a `setState` updater, because a
   * restore can be followed in the same batch by attaching to a recovered
   * conversation — which remounts this component, so an updater queued against
   * it may never run and the text would be lost with it.
   */
  const draftRef = useRef("");

  // Restore the draft once, on mount. Storage can throw in a private window
  // or with site data blocked, so the composer must work without it.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) {
        draftRef.current = saved;
        setDraft(saved);
      }
    } catch {
      // No draft restore; nothing else depends on it.
    }
  }, [draftKey]);

  function handleDraftChange(value: string) {
    draftRef.current = value;
    setDraft(value);
    try {
      window.sessionStorage.setItem(draftKey, value);
    } catch {
      // Draft persistence is a convenience, never a requirement.
    }
  }

  /**
   * Put a failed message back, unless the person has moved on.
   *
   * Clear optimistically while waiting for Eve to accept the send. If delivery
   * fails, restore the earlier message without overwriting a newer draft. If
   * something newer is in the box by the time the failure lands, the newer
   * text wins and the failed message is dropped rather than overwriting it.
   */
  function restoreFailedMessage(message: string) {
    if (draftRef.current.trim().length > 0) return;
    draftRef.current = message;
    try {
      window.sessionStorage.setItem(draftKey, message);
    } catch {
      // Persistence is a convenience; the restored text is what matters —
      // except across the remount a recovery causes, where storage is how it
      // survives.
    }
    setDraft(message);
  }

  return { draft, draftRef, handleDraftChange, restoreFailedMessage };
}
