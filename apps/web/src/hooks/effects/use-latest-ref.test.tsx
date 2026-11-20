import { render, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import { useLatestRef } from "./use-latest-ref";

describe("useLatestRef", () => {
  it("returns a stable ref holding the latest committed value across rerenders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: () => void }) => useLatestRef(value),
      { initialProps: { value: first } },
    );

    const ref = result.current;
    expect(ref.current).toBe(first);

    rerender({ value: second });
    expect(result.current).toBe(ref);
    expect(ref.current).toBe(second);
  });

  it("updates the ref only on commit, not during render", () => {
    const observedDuringRender: string[] = [];
    const exposed: { ref: RefObject<string> | null } = { ref: null };

    function Probe({ value }: { value: string }) {
      const ref = useLatestRef(value);
      observedDuringRender.push(ref.current);
      exposed.ref = ref;
      return null;
    }

    const { rerender } = render(<Probe value="first" />);
    expect(exposed.ref?.current).toBe("first");

    rerender(<Probe value="second" />);
    // During the second render the ref still held the previous committed value;
    // the layout effect updated it only once the render committed.
    expect(observedDuringRender).toEqual(["first", "first"]);
    expect(exposed.ref?.current).toBe("second");
  });
});
