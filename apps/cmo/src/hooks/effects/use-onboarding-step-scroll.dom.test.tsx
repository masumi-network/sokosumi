// @vitest-environment happy-dom

import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingStep } from "../../components/onboarding/step";
import { useOnboardingStepScroll } from "./use-onboarding-step-scroll";

describe("useOnboardingStepScroll (CMO)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls the window to (0, 0) on mount and whenever the onboarding step changes", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    function Probe({ step, note }: { step: OnboardingStep; note?: string }) {
      void note;
      useOnboardingStepScroll(step);
      return null;
    }

    await act(async () => root.render(<Probe step="site" />));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    // Unrelated re-render with unchanged step does not scroll again.
    await act(async () => root.render(<Probe step="site" note="same" />));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<Probe step="brand" />));
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it("re-runs on React Activity reveal and does not throw during SSR", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    function Probe() {
      useOnboardingStepScroll("plan");
      return <span>ok</span>;
    }

    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(
        <Activity mode="hidden">
          <Probe />
        </Activity>,
      ),
    );
    await act(async () =>
      root.render(
        <Activity mode="visible">
          <Probe />
        </Activity>,
      ),
    );
    expect(scrollTo).toHaveBeenCalledTimes(2);

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
