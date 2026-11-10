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
    document.elementFromPoint = () => null;
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
      // It is not under the cursor, so settling alone prefetches nothing.
      expect(prefetch).not.toHaveBeenCalled();
      await act(() => approachElement(link));
      expect(prefetch).toHaveBeenCalledTimes(1);
    },
  );

  it("prefetches the element a scroll leaves under the cursor, once the scroll stops", async () => {
    const prefetch = vi.fn();
    render(<Probe prefetch={prefetch} />);
    const link = screen.getByRole("link");
    const under = vi.fn((_x: number, _y: number): Element | null => link);
    document.elementFromPoint = under;
    document.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 40, clientY: 60 }),
    );

    document.dispatchEvent(new Event("scroll"));
    await act(() => approachElement(link));
    await act(() => vi.advanceTimersByTimeAsync(150));
    // Still scrolling.
    document.dispatchEvent(new Event("scroll"));
    await act(() => vi.advanceTimersByTimeAsync(199));
    expect(prefetch).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(under).toHaveBeenLastCalledWith(40, 60);
  });

  it.each([
    [
      "a cursor with a button down",
      () =>
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: 40,
            clientY: 60,
            buttons: 1,
          }),
        ),
    ],
    [
      "a cursor that left the page",
      () =>
        document.documentElement.dispatchEvent(
          new PointerEvent("pointerleave"),
        ),
    ],
  ])(
    "does not take %s for a reader who stopped on the element",
    async (_, leave) => {
      const prefetch = vi.fn();
      render(<Probe prefetch={prefetch} />);
      const link = screen.getByRole("link");
      const under = vi.fn((x: number, _y: number) => (x === 40 ? link : null));
      document.elementFromPoint = under;
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 40, clientY: 60 }),
      );

      leave();
      document.dispatchEvent(new Event("scroll"));
      await act(() => approachElement(link));
      await act(() => vi.advanceTimersByTimeAsync(201));

      expect(under).toHaveBeenCalled();
      expect(prefetch).not.toHaveBeenCalled();
    },
  );

  it("prefetches once for an element that fired twice during one long scroll", async () => {
    const prefetch = vi.fn();
    render(<Probe prefetch={prefetch} />);
    const link = screen.getByRole("link");
    document.elementFromPoint = () => link;
    document.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 40, clientY: 60 }),
    );

    document.dispatchEvent(new Event("scroll"));
    await act(() => approachElement(link));
    // The scroll goes on past the element's repeat time, so it fires again.
    for (let step = 0; step < 8; step++) {
      await act(() => vi.advanceTimersByTimeAsync(150));
      document.dispatchEvent(new Event("scroll"));
    }
    await act(() => approachElement(link));
    await act(() => vi.advanceTimersByTimeAsync(201));

    expect(prefetch).toHaveBeenCalledTimes(1);
  });

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
