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

/** Approved, nobody paid, nothing connected: Core owes the checkout. */
const unpaid = (patch: Partial<CmoOverview> = {}) =>
  draft({
    ...cmoStrategyVersion(new Date("2026-11-13T09:00:00Z")),
    onboardingStep: "checkout",
    channels: [],
    ...patch,
  });

const linkedin = {
  id: "li",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
  personalProfile: false,
};

/** Paid for: Core waits on the accounts. */
const paid = (patch: Partial<CmoOverview> = {}) =>
  unpaid({
    onboardingStep: "accounts",
    billing: cmoBilling({
      tier: "growth",
      interval: "month",
      status: "active",
    }),
    ...patch,
  });

function actionsFor(
  overview: CmoOverview,
  patch: Partial<OnboardingActions> = {},
): OnboardingActions {
  return { ...inertOnboardingActions(overview), ...patch };
}

it("shows Subscribe as the fourth step, before Launch, and starts Polar's checkout", async () => {
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
        plans={cmoPlans}
        actions={actionsFor(overview, { startPlanCheckout })}
      />,
    ),
  );
  expect(currentStep()).toContain("4");
  expect(currentStep()).toContain("Subscribe");
  expect(text()).toContain("$417 a month");
  expect(text()).not.toContain("Launch Cuso");
  await press("Scale");
  await press("Start Scale");
  expect(startPlanCheckout).toHaveBeenCalledWith("year", "scale");
  expect(assign).toHaveBeenCalledWith("https://polar.sh/checkout/c_1");
});

it("goes on to Launch once the payment is confirmed", async () => {
  const overview = unpaid();
  let polled: CmoOverview = overview;
  const loadState = vi.fn(async () => ({ overview: polled, messages: [] }));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        plans={cmoPlans}
        returnedFromCheckout
        actions={actionsFor(overview, { loadState })}
      />,
    ),
  );
  expect(text()).toContain("Confirming your payment");

  // Polar's confirmation has not arrived yet: it keeps waiting.
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(loadState).toHaveBeenCalled();
  expect(text()).toContain("Confirming your payment");

  polled = paid();
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(assign).not.toHaveBeenCalled();
  expect(currentStep()).toContain("Launch");
  expect(text()).toContain("Connect where I post");
});

it("opens the chat when the payment lands for a Cuso with an account already connected", async () => {
  const overview = unpaid({ channels: [linkedin] });
  let polled: CmoOverview = overview;
  const loadState = vi.fn(async () => ({ overview: polled, messages: [] }));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        plans={cmoPlans}
        returnedFromCheckout
        actions={actionsFor(overview, { loadState })}
      />,
    ),
  );
  polled = paid({ onboardingStep: "done", channels: [linkedin] });
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(assign).toHaveBeenCalledWith("/?project=project-1");
  // No flash of Launch while the app loads.
  expect(text()).toContain("Confirming your payment");
});

it("celebrates on Launch once paid and connected, and stays there", async () => {
  const overview = paid({ onboardingStep: "done", channels: [linkedin] });
  const loadState = vi.fn(async () => ({ overview, messages: [] }));
  const finishAccounts = vi.fn(() => new Promise<never>(() => {}));
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={paid({ channels: [linkedin] })}
        messages={[]}
        actions={actionsFor(overview, { loadState, finishAccounts })}
      />,
    ),
  );
  expect(currentStep()).toContain("Launch");
  await press("Launch Cuso");
  expect(text()).toContain("is on it.");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  // Core is done at the connection; the poll does not jump to the app.
  await act(async () => vi.advanceTimersByTimeAsync(2_500));
  expect(assign).not.toHaveBeenCalled();
  expect(finishAccounts).not.toHaveBeenCalled();
  await press("Go to Today");
  expect(finishAccounts).toHaveBeenCalledTimes(1);
});

it("skips Subscribe for a Cuso with Tester credits", async () => {
  const overview = unpaid({
    onboardingStep: "accounts",
    billing: cmoBilling({ hasTesterCredits: true }),
  });
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        actions={actionsFor(overview)}
      />,
    ),
  );
  expect(currentStep()).toContain("Launch");
});

it("goes back to the plans for a person who has not paid", async () => {
  const overview = unpaid();
  await act(async () =>
    root.render(
      <OnboardingFlow
        overview={overview}
        messages={[]}
        plans={cmoPlans}
        returnedFromCheckout
        actions={actionsFor(overview)}
      />,
    ),
  );
  await press("I haven't paid");
  expect(text()).toContain("Start Starter");
});
