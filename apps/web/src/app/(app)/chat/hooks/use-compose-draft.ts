"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import {
  type ComposeDraft,
  clearComposeDraft,
  EMPTY_COMPOSE_DRAFT,
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";

const DEFAULT_DEBOUNCE_MS = 300;

export function usePersistComposeDraft({
  key,
  draft,
  onHydrate,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  key: string | null;
  draft: ComposeDraft;
  onHydrate: (draft: ComposeDraft) => void;
  debounceMs?: number;
}): { clearDraft: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const pendingDraftRef = useRef<ComposeDraft | null>(null);
  const skipNextPersistRef = useRef(false);
  const keyRef = useRef(key);
  const hydrate = useEffectEvent(onHydrate);

  const cancelDebounce = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingKeyRef.current = null;
    pendingDraftRef.current = null;
  }, []);

  const flushPending = useCallback(() => {
    if (pendingKeyRef.current != null && pendingDraftRef.current != null) {
      setComposeDraft(pendingKeyRef.current, pendingDraftRef.current);
    }
    cancelDebounce();
  }, [cancelDebounce]);

  useEffect(() => {
    const previousKey = keyRef.current;
    if (previousKey !== key) {
      flushPending();
      keyRef.current = key;
    }

    if (key == null) {
      return;
    }

    skipNextPersistRef.current = true;
    hydrate(getComposeDraft(key) ?? EMPTY_COMPOSE_DRAFT);
  }, [key, flushPending]);

  useEffect(() => {
    if (key == null) {
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    pendingKeyRef.current = key;
    pendingDraftRef.current = draft;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      if (pendingKeyRef.current != null && pendingDraftRef.current != null) {
        setComposeDraft(pendingKeyRef.current, pendingDraftRef.current);
      }
      timerRef.current = null;
      pendingKeyRef.current = null;
      pendingDraftRef.current = null;
    }, debounceMs);
  }, [key, draft, debounceMs]);

  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  const clearDraft = useCallback(() => {
    cancelDebounce();
    if (key != null) {
      clearComposeDraft(key);
    }
  }, [cancelDebounce, key]);

  return { clearDraft };
}
