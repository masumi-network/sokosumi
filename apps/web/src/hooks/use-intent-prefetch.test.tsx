import { act, render, screen } from "@testing-library/react";
import { ForesightManager } from "js.foresight";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approachElement } from "@/test/approach-element";
import { useIntentPrefetch } from "./use-intent-prefetch";

function Probe({
  prefetch,
  enabled,
}: {
  prefetch: () => void;
  enabled?: boolean;
}) {
  const ref = useIntentPrefetch<HTMLAnchorElement>(prefetch, {
    reactivateAfter: 1_000,
    enabled,
  });
  return (
    <a data-active="true" href="/somewhere" ref={ref}>
      Open
    </a>
  );
}

// The hook keeps the time of the last scroll or drag for the whole page, so
// each test starts well clear of what the one before it disturbed.
const TEST_GAP_MS = 10_000;
let testStart = 0;

describe("useIntentPrefetch", () => {
  beforeEach(() => {
    testStart += TEST_GAP_MS;
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date"],
      now: testStart,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a scroll", () => document.dispatchEvent(new Event("scroll"))],
    [
      "a drag",
      () =>
        document.dispatchEvent(new PointerEvent("pointermove", { buttons: 1 })),
    ],
  ])(
    "does not take %s under the cursor for an approach",
    async (_, disturb) => {
      const prefetch = vi.fn();
      render(<Probe prefetch={prefetch} />);
      const link = screen.getByRole("link");

      disturb();
      await act(() => approachElement(link));
      expect(prefetch).not.toHaveBeenCalled();

      // Once things settle the element predicts again, well before its repeat time.
      await act(() => vi.advanceTimersByTimeAsync(201));
      await act(() => approachElement(link));
      expect(prefetch).toHaveBeenCalledTimes(1);
    },
  );

  it("prefetches on an approach and leaves the element's own data-active alone", async () => {
    const prefetch = vi.fn();
    render(<Probe prefetch={prefetch} />);
    const link = screen.getByRole("link");

    await act(() => approachElement(link));

    expect(prefetch).toHaveBeenCalledTimes(1);
    // The sidebar styles its open row by this attribute.
    expect(link).toHaveAttribute("data-active", "true");
  });

  it("calls the prefetch of the latest render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Probe prefetch={first} />);
    view.rerender(<Probe prefetch={second} />);

    await act(() => approachElement(screen.getByRole("link")));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("registers nothing while disabled, and lets go of the element on unmount", () => {
    const view = render(<Probe prefetch={vi.fn()} enabled={false} />);
    const link = screen.getByRole("link");
    expect(ForesightManager.instance.registeredElements.has(link)).toBe(false);

    view.rerender(<Probe prefetch={vi.fn()} />);
    expect(ForesightManager.instance.registeredElements.has(link)).toBe(true);

    view.unmount();
    expect(ForesightManager.instance.registeredElements.has(link)).toBe(false);
  });
});
