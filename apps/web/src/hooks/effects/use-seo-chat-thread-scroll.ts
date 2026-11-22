"use client";

import { type RefObject, useEffect } from "react";

/** Room above a reply that just landed, so its question is not on the edge. */
const LANDED_INSET_PX = 16;

/**
 * Scrolls the SEO chat thread container to its end while following a new
 * question, or to the top of the latest `<article>` when a sent reply lands.
 */
export function useSeoChatThreadScroll(
  thread: RefObject<HTMLDivElement | null>,
  follow: string,
  landed: boolean,
): void {
  useEffect(() => {
    const box = thread.current;
    if (!box) return;
    const last = box.querySelector<HTMLElement>("article:last-of-type");
    box.scrollTop =
      landed && last ? last.offsetTop - LANDED_INSET_PX : box.scrollHeight;
  }, [follow, landed]);
}
