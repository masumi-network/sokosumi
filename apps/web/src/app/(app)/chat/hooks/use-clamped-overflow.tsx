"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import {
  type ClampedOverflowState,
  useClampedOverflowCacheSync,
} from "@/hooks/effects/use-clamped-overflow-cache-sync";
import { useLayoutResizeObserver } from "@/hooks/effects/use-resize-observer";

const ClampedOverflowContext = createContext<Map<
  string,
  ClampedOverflowState
> | null>(null);

/** Disclosure state survives row unmounts, but ends with the open transcript. */
export function ClampedOverflowProvider({ children }: { children: ReactNode }) {
  const [states] = useState(() => new Map<string, ClampedOverflowState>());
  return (
    <ClampedOverflowContext value={states}>{children}</ClampedOverflowContext>
  );
}

export function useClampedOverflow({
  cacheKey,
  resetKey,
}: {
  cacheKey: string;
  resetKey: string;
}) {
  const states = useContext(ClampedOverflowContext);
  // Restore before the virtualizer measures the mounting row.
  const cached = states?.get(cacheKey);
  const remembered =
    cached?.resetKey === resetKey
      ? cached
      : { cacheKey, resetKey, expanded: false, overflows: false };
  const [state, setState] = useState(remembered);
  const current =
    state.cacheKey === cacheKey && state.resetKey === resetKey
      ? state
      : remembered;
  if (current !== state) {
    setState(current);
  }
  const { expanded, overflows } = current;
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(
    null,
  );

  function toggleExpanded() {
    setState((previous) => ({ ...previous, expanded: !previous.expanded }));
  }

  // Keep only the latest version per body or quote, including when no text
  // element is mounted (for example, a message containing only jumbo emoji).
  useClampedOverflowCacheSync(states, cacheKey, current);

  useLayoutResizeObserver(
    expanded ? null : contentElement,
    () => {
      if (!contentElement) {
        return;
      }
      const nextOverflows =
        contentElement.scrollHeight > contentElement.clientHeight + 1;
      setState((previous) =>
        previous.overflows === nextOverflows
          ? previous
          : { ...previous, overflows: nextOverflows },
      );
    },
    { immediate: true, resetKey: `${cacheKey}\0${resetKey}` },
  );

  return { expanded, toggleExpanded, overflows, contentRef: setContentElement };
}
