// @vitest-environment happy-dom

import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { cmoOverview, cmoStrategy } from "../../test-fixtures/cmo";
import { StrategyStep } from "./strategy-step";

// happy-dom cannot run Web Animations; motion's would reject on unmount.
MotionGlobalConfig.skipAnimations = true;

it("swaps the plan for a re-planning screen the moment a pace is tapped", async () => {
  window.scrollTo = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish = (_refusal: string | null) => {};
  const onChange = vi.fn(
    () => new Promise<string | null>((resolve) => (finish = resolve)),
  );
  try {
    await act(async () =>
      root.render(
        <StrategyStep
          overview={cmoOverview({
            onboardingStep: "strategy",
            viewerCanApprove: true,
            strategy: {
              ...cmoStrategy,
              pace: { level: "active", why: "One a day", perWeek: 7 },
            },
          })}
          onChange={onChange}
          onSetAds={async () => null}
          onApprove={async () => {}}
          ahead={{ label: "Results", onClick: () => {} }}
        />,
      ),
    );
    const allIn = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("All-in"),
    );
    await act(async () => allIn?.click());

    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("Change the pace to All-in"),
    );
    expect(container.textContent).toContain("Cuso is re-planning your month");
    expect(container.textContent).toContain("All-in pace.");
    expect(container.textContent).not.toContain("How much Cuso publishes");

    await act(async () => finish("Not enough credits"));
    expect(container.textContent).not.toContain(
      "Cuso is re-planning your month",
    );
    expect(container.textContent).toContain("How much Cuso publishes");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
