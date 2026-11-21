"use client";

import { type RefObject, useEffect, useState } from "react";
import { pageTextMatches } from "@/lib/utils/page-text-matches";
import "./page-text-find.css";

export function usePageTextFind(
  content: RefObject<HTMLElement | null>,
  query: string,
) {
  const [matches, setMatches] = useState<Range[]>([]);
  const [position, setPosition] = useState(0);
  const count = matches.length;
  const index = count ? Math.min(position, count - 1) : 0;
  useEffect(() => {
    const root = content.current;
    setPosition(0);
    if (!root || !query.trim()) {
      setMatches([]);
      return;
    }
    let frame: number | undefined;
    function scan() {
      frame = undefined;
      if (!root) return;
      const next = pageTextMatches(root, query);
      // A chart animation or a clock tick must not scroll the reader back to the current hit.
      setMatches((previous) =>
        previous.length === next.length &&
        previous.every((old, index) => {
          const hit = next[index];
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
    }
    scan();
    const observer = new MutationObserver(() => {
      if (frame === undefined) frame = requestAnimationFrame(scan);
    });
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "aria-hidden",
        "class",
        "style",
        "inert",
        "open",
      ],
    });
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [content, query]);
  useEffect(() => {
    const active = matches[index];
    if (!active) return;
    const highlights = globalThis.CSS?.highlights;
    const parent = active.startContainer.parentElement;
    parent?.scrollIntoView?.({ block: "center", inline: "nearest" });
    if (highlights && typeof Highlight === "function") {
      const all = new Highlight();
      for (const range of matches) all.add(range);
      highlights.set("sokosumi-page-matches", all);
      highlights.set("sokosumi-page-current", new Highlight(active));
      return () => {
        highlights.delete("sokosumi-page-matches");
        highlights.delete("sokosumi-page-current");
      };
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(active);
    return () => {
      if (selection?.rangeCount && selection.getRangeAt(0) === active)
        selection.removeAllRanges();
    };
  }, [index, matches]);
  return {
    count,
    index,
    step(delta: number) {
      if (count) setPosition((index + delta + count) % count);
    },
  };
}
