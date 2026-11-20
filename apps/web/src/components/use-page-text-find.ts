"use client";

import { useEffect, useState } from "react";
import { useMutationObserver } from "@/hooks/effects/use-mutation-observer";
import { pageTextMatches } from "@/lib/utils/page-text-matches";
import "./page-text-find.css";

const EMPTY_MATCHES: Range[] = [];

const PAGE_TEXT_FIND_MUTATION_INIT: MutationObserverInit = {
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden", "aria-hidden", "class", "style", "inert", "open"],
};

export function usePageTextFind(content: HTMLElement | null, query: string) {
  const [matches, setMatches] = useState<Range[]>(EMPTY_MATCHES);
  const [position, setPosition] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setPosition(0);
    if (!query.trim()) {
      setMatches(EMPTY_MATCHES);
    }
  }
  const active = Boolean(content && query.trim());
  const activeMatches = active ? matches : EMPTY_MATCHES;
  const count = activeMatches.length;
  const index = count ? Math.min(position, count - 1) : 0;

  useMutationObserver(
    active ? content : null,
    () => {
      if (!content) return;
      const next = pageTextMatches(content, query);
      // A chart animation or a clock tick must not scroll the reader back to the current hit.
      setMatches((previous) =>
        previous.length === next.length &&
        previous.every((old, matchIndex) => {
          const hit = next[matchIndex];
          return (
            old.startContainer === hit.startContainer &&
            old.startOffset === hit.startOffset &&
            old.endContainer === hit.endContainer &&
            old.endOffset === hit.endOffset
          );
        })
          ? previous
          : next,
      );
    },
    {
      init: PAGE_TEXT_FIND_MUTATION_INIT,
      immediate: true,
      coalesceFrame: true,
      resetKey: query,
    },
  );

  useEffect(() => {
    const activeMatch = activeMatches[index];
    if (!activeMatch) return;
    const highlights = globalThis.CSS?.highlights;
    const parent = activeMatch.startContainer.parentElement;
    parent?.scrollIntoView?.({ block: "center", inline: "nearest" });
    if (highlights && typeof Highlight === "function") {
      const all = new Highlight();
      for (const range of activeMatches) all.add(range);
      highlights.set("sokosumi-page-matches", all);
      highlights.set("sokosumi-page-current", new Highlight(activeMatch));
      return () => {
        highlights.delete("sokosumi-page-matches");
        highlights.delete("sokosumi-page-current");
      };
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(activeMatch);
    return () => {
      if (selection?.rangeCount && selection.getRangeAt(0) === activeMatch)
        selection.removeAllRanges();
    };
  }, [index, activeMatches]);
  return {
    count,
    index,
    step(delta: number) {
      if (count) setPosition((index + delta + count) % count);
    },
  };
}
