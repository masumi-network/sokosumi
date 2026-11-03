// @vitest-environment happy-dom

import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoOverview, cmoStrategy } from "../../test-fixtures/cmo";
import { StrategyStep } from "./strategy-step";

// happy-dom cannot run Web Animations; motion's would reject on unmount.
MotionGlobalConfig.skipAnimations = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.scrollTo = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** A Core call the test answers when it chooses. */
function pending() {
  let answer = (_refusal: string | null) => {};
  const call = vi.fn(
    () => new Promise<string | null>((resolve) => (answer = resolve)),
  );
  return { call, answer: (refusal: string | null) => answer(refusal) };
}

async function renderStep(
  onChange: (note: string) => Promise<string | null>,
  onSetAds: (monthly: number, currency: string) => Promise<string | null>,
) {
  await act(async () =>
    root.render(
      <StrategyStep
        overview={cmoOverview({
          onboardingStep: "strategy",
          viewerCanApprove: true,
          strategy: {
            ...cmoStrategy,
            pace: { level: "active", why: "One a day", perWeek: 7 },
            ads: {
              monthly: 300,
              currency: "EUR",
              expect: "Some sales",
              without: "Organic only",
            },
          },
        })}
        onChange={onChange}
        onSetAds={onSetAds}
        onApprove={async () => {}}
        ahead={{ label: "Results", onClick: () => {} }}
      />,
    ),
  );
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}"`);
  return found;
}

const planHidden = () => container.querySelector(".bb")?.hasAttribute("hidden");
const replanning = () =>
  container.textContent?.includes("Cuso is re-planning your month");

it("swaps the plan for a re-planning screen the moment a pace is tapped", async () => {
  const core = pending();
  await renderStep(core.call, async () => null);
  await act(async () => button("All-in").click());

  expect(core.call).toHaveBeenCalledWith(
    expect.stringContaining("Change the pace to All-in"),
  );
  expect(replanning()).toBe(true);
  expect(container.textContent).toContain("All-in pace.");
  expect(planHidden()).toBe(true);

  await act(async () => core.answer("Not enough credits"));
  expect(replanning()).toBe(false);
  expect(planHidden()).toBe(false);
  expect(container.textContent).toContain("You're out of credits.");
});

it("re-plans on a new ad budget at once, and keeps the amount when it is refused", async () => {
  const core = pending();
  await renderStep(async () => null, core.call);
  await act(async () => button("Set your own budget").click());
  const amount = container.querySelector<HTMLInputElement>(
    'input[aria-label="Monthly ad budget in EUR"]',
  );
  expect(amount).not.toBeNull();
  await act(async () => button("Set budget").click());

  expect(core.call).toHaveBeenCalledWith(300, "EUR");
  expect(replanning()).toBe(true);

  await act(async () => core.answer("Not enough credits"));
  expect(replanning()).toBe(false);
  expect(
    container.querySelector('input[aria-label="Monthly ad budget in EUR"]'),
  ).not.toBeNull();
});

it("shows the re-planning screen for a written change before Core answers", async () => {
  const core = pending();
  await renderStep(core.call, async () => null);
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="What should Cuso change?"]',
  );
  await act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "More videos");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Change it").click());

  expect(core.call).toHaveBeenCalledWith("More videos");
  expect(replanning()).toBe(true);

  await act(async () => core.answer(null));
  expect(replanning()).toBe(false);
});
