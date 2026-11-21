// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingPoll } from "./use-onboarding-poll";

describe("useOnboardingPoll", () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Probe({ onPoll }: { onPoll: () => void | Promise<void> }) {
    useOnboardingPoll(onPoll, { pollMs: 2_500, hiddenPollMs: 20_000 });
    return null;
  }

  it("polls on interval while visible, throttles while hidden, polls on visibilitychange, and stops on unmount", async () => {
    const onPoll = vi.fn();
    await act(async () => root.render(<Probe onPoll={onPoll} />));

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    await act(async () => {
      vi.advanceTimersByTime(17_500);
    });
    expect(onPoll).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(onPoll).toHaveBeenCalledTimes(2);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onPoll).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onPoll).toHaveBeenCalledTimes(3);
  });
});
