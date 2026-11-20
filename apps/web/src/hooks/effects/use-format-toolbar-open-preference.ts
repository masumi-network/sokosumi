"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  getFormatToolbarOpenPreference,
  setFormatToolbarOpenPreference,
} from "@/app/chat/utils/format-toolbar-preference-storage";

const usePrePaintEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Reads the persisted Slack-style Aa formatting toolbar preference before
 * paint so the chat composer and its loading fallback reserve the same height
 * without a post-paint shift. SSR and initial hydration start closed.
 */
export function useFormatToolbarOpenPreference(): readonly [
  boolean,
  (next: boolean) => void,
] {
  const [open, setOpenState] = useState(false);

  usePrePaintEffect(() => {
    const stored = getFormatToolbarOpenPreference();
    if (stored !== null) {
      setOpenState(stored);
    }
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setFormatToolbarOpenPreference(next);
  }, []);

  return [open, setOpen] as const;
}
