"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Keep the gallery still while the prompt grows.
 *
 * The feed is a bottom-anchored scroller, so anything that shrank it moved
 * every image on screen: each new line of a brief, or a long template landing
 * in the box. The composer is docked over the feed's bottom edge instead, in a
 * slot as tall as the composer minus whatever the prompt has grown past its
 * resting height. A growing brief then rises over the feed, the way a sheet
 * would, and the feed's height only follows the composer's own rows.
 */
export function useImageStudioSteadyDock(
  promptRef: RefObject<HTMLTextAreaElement | null>,
  floating: boolean,
) {
  const slotRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const dock = dockRef.current;
    if (!slot || !dock) return;
    if (floating) {
      slot.style.height = "";
      return;
    }
    const sync = () => {
      const prompt = promptRef.current;
      const growth = prompt
        ? prompt.offsetHeight -
          Number.parseFloat(getComputedStyle(prompt).minHeight)
        : 0;
      slot.style.height = `${dock.offsetHeight - (growth > 0 ? growth : 0)}px`;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [promptRef, floating]);
  return { slotRef, dockRef };
}
