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

export function useClampedOverflow(resetKey: string) {
  const states = useContext(ClampedOverflowContext);
  // Restore before the virtualizer measures the mounting row.
  const remembered = states?.get(resetKey) ?? {
    resetKey,
    expanded: false,
    overflows: false,
  };
  const [state, setState] = useState(remembered);
  const current = state.resetKey === resetKey ? state : remembered;
  if (current !== state) {
    setState(current);
  }
  const { expanded, overflows } = current;
  const contentRef = useRef<HTMLDivElement | null>(null);

  function toggleExpanded() {
    const next = { ...current, expanded: !expanded };
    states?.set(resetKey, next);
    setState(next);
  }

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
      const next = { resetKey, expanded: false, overflows };
      states?.set(resetKey, next);
      setState((previous) =>
        previous.resetKey === resetKey && previous.overflows === overflows
          ? previous
          : next,
      );
    }

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, resetKey, states]);

  return { expanded, toggleExpanded, overflows, contentRef };
}
