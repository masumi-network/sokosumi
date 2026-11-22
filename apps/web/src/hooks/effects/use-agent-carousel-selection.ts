"use client";

import { useEffect, useState } from "react";

export interface AgentCarouselSelectionApi {
  on: (event: "select", callback: () => void) => unknown;
  off: (event: "select", callback: () => void) => unknown;
  selectedScrollSnap: () => number;
  canScrollNext: () => boolean;
  canScrollPrev: () => boolean;
}

export interface AgentCarouselSelectionState {
  current: number;
  canScrollNext: boolean;
  canScrollPrev: boolean;
}

/**
 * Subscribes to Embla's `select` event on `AgentCarousel`'s `CarouselApi` and
 * schedules an initial animation-frame measurement for slide/arrow state.
 */
export function useAgentCarouselSelection(
  api: AgentCarouselSelectionApi | undefined,
): AgentCarouselSelectionState {
  const [current, setCurrent] = useState(0);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [canScrollPrev, setCanScrollPrev] = useState(false);

  useEffect(() => {
    if (!api) {
      return;
    }

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap());
      setCanScrollNext(api.canScrollNext());
      setCanScrollPrev(api.canScrollPrev());
    };

    api.on("select", handleSelect);

    requestAnimationFrame(() => {
      handleSelect();
    });

    return () => {
      api.off("select", handleSelect);
    };
  }, [api]);

  return { current, canScrollNext, canScrollPrev };
}
