import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptBoundaryRow } from "./transcript-boundary-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

const observers: Array<{
  callback: ObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ObserverCallback) {
        observers.push({
          callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TranscriptBoundaryRow", () => {
  it("loads the page older than its range on tap", () => {
    const onLoad = vi.fn();
    render(
      <TranscriptBoundaryRow
        cursorMessageId="msg-9"
        isGap={false}
        status="idle"
        onLoad={onLoad}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "loadOlder" }));

    expect(onLoad).toHaveBeenCalledExactlyOnceWith("msg-9");
  });

  it("says messages are missing between two ranges", () => {
    render(
      <TranscriptBoundaryRow
        cursorMessageId="msg-9"
        isGap
        status="idle"
        onLoad={vi.fn()}
      />,
    );

    // One button, so a thumb on the label lands as well as on the action.
    expect(
      screen.getByRole("button", {
        name: "Boundary.missingHere Boundary.loadMissing",
      }),
    ).toBeInTheDocument();
  });

  it("loads on its own once it scrolls into view", () => {
    const onLoad = vi.fn();
    render(
      <TranscriptBoundaryRow
        cursorMessageId="msg-9"
        isGap
        status="idle"
        onLoad={onLoad}
      />,
    );

    expect(observers).toHaveLength(1);
    observers[0]?.callback([{ isIntersecting: false }]);
    expect(onLoad).not.toHaveBeenCalled();
    observers[0]?.callback([{ isIntersecting: true }]);

    expect(onLoad).toHaveBeenCalledExactlyOnceWith("msg-9");
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it("ignores taps and visibility while loading", () => {
    const onLoad = vi.fn();
    render(
      <TranscriptBoundaryRow
        cursorMessageId="msg-9"
        isGap={false}
        status="loading"
        onLoad={onLoad}
      />,
    );

    const button = screen.getByRole("button", { name: "loadingOlder" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);

    expect(onLoad).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
  });

  it("offers a retry inline after a failed load and does not auto-load", () => {
    const onLoad = vi.fn();
    render(
      <TranscriptBoundaryRow
        cursorMessageId="msg-9"
        isGap
        status="failed"
        onLoad={onLoad}
      />,
    );

    expect(observers).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Boundary.loadFailed");
    // The error text is inside the button, so a tap on it retries as well.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Boundary.loadFailed Boundary.retry",
      }),
    );

    expect(onLoad).toHaveBeenCalledExactlyOnceWith("msg-9");
  });
});
