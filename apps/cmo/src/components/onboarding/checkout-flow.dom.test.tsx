// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  cmoBilling,
  cmoPlans,
  cmoStrategyVersion,
} from "../../test-fixtures/cmo";
import { draft } from "../../test-fixtures/onboarding";
import { inertOnboardingActions, type OnboardingActions } from "./actions";
import { OnboardingFlow } from "./flow";

// happy-dom cannot run Web Animations; motion's would reject on unmount.
MotionGlobalConfig.skipAnimations = true;

let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = vi.fn();
  assign.mockReset();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? "";
const press = (label: string) =>
  act(async () => {
    const found = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(label),
    );
    if (!found) throw new Error(`No button "${label}"`);
    found.click();
  });
const currentStep = () =>
  container.querySelector('[aria-current="step"]')?.textContent;

/** Approved, a network connected, nobody paid: Core owes the checkout. */
const unpaid = (patch: Partial<CmoOverview> = {}) =>
  draft({
    ...cmoStrategyVersion(new Date("2026-11-13T09:00:00Z")),
    onboardingStep: "checkout",
    channels: [
      {
        id: "li",
        provider: "linkedin",
        handle: "acme",
        displayName: "Acme",
        status: "ACTIVE",
      },
    ],
    ...patch,
  });

function actionsFor(
  overview: CmoOverview,
  patch: Partial<OnboardingActions> = {},
): OnboardingActions {
  return { ...inertOnboardingActions(overview), ...patch };
}

it("goes from Launch to the checkout instead of the celebration", async () => {
  const overview = unpaid();
  const finishAccounts = vi.fn(() => new Promise<never>(() => {}));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        actions={actionsFor(overview, { finishAccounts })}
      />,
    ),
  );
  expect(currentStep()).toContain("Launch");
  await press("Launch Cuso");
  expect(finishAccounts).toHaveBeenCalledTimes(1);
  expect(text()).not.toContain("is on it.");
});

it("still celebrates a Cuso with Tester credits, who owes no checkout", async () => {
  const overview = unpaid({
    onboardingStep: "done",
    billing: cmoBilling({ hasTesterCredits: true }),
  });
  const finishAccounts = vi.fn(() => new Promise<never>(() => {}));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        actions={actionsFor(overview, { finishAccounts })}
      />,
    ),
  );
  await press("Launch Cuso");
  expect(finishAccounts).not.toHaveBeenCalled();
  expect(text()).toContain("is on it.");
});

it("shows the plans as the fifth step and starts Polar's checkout", async () => {
  const overview = unpaid();
  const startPlanCheckout = vi.fn(async () => ({
    url: "https://polar.sh/checkout/c_1",
    error: null,
  }));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        skipped={["accounts"]}
        plans={cmoPlans}
        actions={actionsFor(overview, { startPlanCheckout })}
      />,
    ),
  );
  expect(currentStep()).toContain("Subscribe");
  expect(text()).toContain("25,000 credits every month");
  await press("Scale");
  await press("Continue to payment");
  expect(startPlanCheckout).toHaveBeenCalledWith("month", "scale");
  expect(assign).toHaveBeenCalledWith("https://polar.sh/checkout/c_1");
});

it("confirms the payment back from Polar and opens the chat once the subscription is active", async () => {
  const overview = unpaid();
  let polled: CmoOverview = overview;
  const loadState = vi.fn(async () => ({ overview: polled, messages: [] }));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        skipped={["accounts"]}
        plans={cmoPlans}
        returnedFromCheckout
        actions={actionsFor(overview, { loadState })}
      />,
    ),
  );
  expect(text()).toContain("Confirming your payment");
  expect(text()).not.toContain("Continue to payment");

  // Polar's confirmation has not arrived yet: it keeps waiting.
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(loadState).toHaveBeenCalled();
  expect(text()).toContain("Confirming your payment");
  expect(assign).not.toHaveBeenCalled();

  polled = {
    ...overview,
    onboardingStep: "done",
    billing: cmoBilling({
      tier: "growth",
      interval: "month",
      status: "active",
    }),
  };
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(assign).toHaveBeenCalledWith("/?project=project-1");
  // No flash of Launch while the app loads.
  expect(text()).toContain("Confirming your payment");
});

it("goes back to the plans for a person who has not paid", async () => {
  const overview = unpaid();
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        skipped={["accounts"]}
        plans={cmoPlans}
        returnedFromCheckout
        actions={actionsFor(overview)}
      />,
    ),
  );
  await press("I haven't paid");
  expect(text()).toContain("Continue to payment");
});
