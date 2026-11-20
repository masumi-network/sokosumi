import { render, renderHook } from "@testing-library/react";
import { Activity, useRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useMessageEditComposerFocus } from "./use-message-edit-composer-focus";

describe("useMessageEditComposerFocus", () => {
  it("calls focusAtEnd once on mount and skips unrelated re-renders", () => {
    const focusAtEnd = vi.fn();
    const ref = { current: { focusAtEnd } };

    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        useMessageEditComposerFocus(ref);
      },
      { initialProps: { tick: 0 } },
    );

    expect(focusAtEnd).toHaveBeenCalledTimes(1);

    rerender({ tick: 1 });
    expect(focusAtEnd).toHaveBeenCalledTimes(1);
  });

  it("handles a null ref without throwing and re-focuses on Activity reveal", () => {
    const focusAtEnd = vi.fn();

    function Probe({ ready }: { ready: boolean }) {
      const ref = useRef<{ focusAtEnd: () => void } | null>(null);
      ref.current = ready ? { focusAtEnd } : null;
      useMessageEditComposerFocus(ref);
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe ready={false} />
      </Activity>,
    );
    expect(focusAtEnd).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <Probe ready />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe ready />
      </Activity>,
    );
    expect(focusAtEnd).toHaveBeenCalledTimes(1);
  });

  it("does not throw during SSR", () => {
    function Probe() {
      const ref = useRef<{ focusAtEnd: () => void } | null>(null);
      useMessageEditComposerFocus(ref);
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
