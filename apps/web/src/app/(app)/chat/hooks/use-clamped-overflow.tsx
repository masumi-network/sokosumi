"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface ClampedOverflowState {
  cacheKey: string;
  resetKey: string;
  expanded: boolean;
  overflows: boolean;
}

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
  const contentRef = useRef<HTMLDivElement | null>(null);

  function toggleExpanded() {
    setState((previous) => ({ ...previous, expanded: !previous.expanded }));
  }

  // Keep only the latest version per body or quote, including when no text
  // element is mounted (for example, a message containing only jumbo emoji).
  useLayoutEffect(() => {
    states?.set(cacheKey, current);
  }, [cacheKey, current, states]);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || expanded) {
      return;
    }

    function measureOverflow() {
      const el = contentRef.current;
      if (!el) {
        return;
      }
      const overflows = el.scrollHeight > el.clientHeight + 1;
      setState((previous) =>
        previous.overflows === overflows
          ? previous
          : { ...previous, overflows },
      );
    }

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [cacheKey, expanded, resetKey]);

  return { expanded, toggleExpanded, overflows, contentRef };
}
