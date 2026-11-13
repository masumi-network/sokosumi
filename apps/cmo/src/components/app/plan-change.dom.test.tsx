// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoBilling, cmoOverview, cmoPlans } from "../../test-fixtures/cmo";
import { CmoApp, type CmoAppActions } from "./cmo-app";

/**
 * Settings after a plan change (ADR 0068): Core has written Polar's answer
 * when the change returns, and the upgrade's credits follow with Polar's paid
 * order, so the card shows both without a reload.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
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
const buttons = () => [...container.querySelectorAll("button")];
const press = (label: string) =>
  act(async () => {
    const found = buttons().find((element) => element.textContent === label);
    if (!found) throw new Error(`No button "${label}"`);
    found.click();
  });

/** A monthly subscription at this tier with these credits. */
function subscribed(
  billing: Partial<CmoOverview["billing"]>,
  patch: Partial<CmoOverview> = {},
): CmoOverview {
  return cmoOverview({
    ...patch,
    billing: cmoBilling({
      tier: "starter",
      interval: "month",
      status: "active",
      periodEnd: new Date("2027-01-13T10:00:00.000Z"),
      availableCredits: 10_000,
      ...billing,
    }),
  });
}

function render(overview: CmoOverview, actions: Partial<CmoAppActions>) {
  const none = async () => ({ url: null, error: null });
  const same = async () => overview;
  const result = async () => ({ overview, error: null });
  return act(async () =>
    root.render(
      <CmoApp
        overview={overview}
        messages={[]}
        name="Ada"
        email="ada@acme.io"
        initialView="settings"
        plans={cmoPlans}
        actions={{
          loadState: async () => ({ overview, messages: [] }),
          sendMessage: async () => {},
          skipSubscription: async () => ({ error: null }),
          loadPieceText: async () => null,
          approveStrategy: same,
          setAdBudget: result,
          revertUpdate: same,
          saveBrandBrain: same,
          retryLearning: result,
          pauseEntry: same,
          connectChannel: none,
          addMailingList: result,
          connectMeasurement: none,
          connectAds: none,
          launchAd: result,
          setAdCampaignStatus: result,
          loadAdCampaigns: async () => [],
          startOver: async () => null,
          startTopUp: none,
          subscribe: none,
          changePlan: async () => ({ change: null, error: null }),
          openPortal: none,
          signOut: async () => {},
          ...actions,
        }}
      />,
    ),
  );
}

it("shows the upgraded plan at once and its credits once Polar's order lands", async () => {
  // What Core holds: the tier once the change returns, the credits later.
  let core = subscribed({});
  await render(core, {
    loadState: async () => ({ overview: core, messages: [] }),
    changePlan: async () => {
      core = subscribed({ tier: "growth" });
      return { change: "upgrade", error: null };
    },
  });

  await press("Move to Growth");
  await press("Upgrade now");

  expect(text()).toContain("Moved to Growth.");
  // Growth is the plan now: the card offers the other two.
  expect(text()).toContain("Move to Starter");
  expect(text()).not.toContain("Move to Growth");

  core = subscribed({ tier: "growth", availableCredits: 17_500 });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));

  expect(text()).toContain("17500");
});

it("shows a scheduled downgrade as soon as the change returns", async () => {
  let core = subscribed({ tier: "growth" });
  await render(core, {
    loadState: async () => ({ overview: core, messages: [] }),
    changePlan: async () => {
      core = subscribed({ tier: "growth", pendingTier: "starter" });
      return { change: "downgrade", error: null };
    },
  });

  await press("Move to Starter");
  await press("Downgrade");

  expect(text()).toContain("Moves to Starter on 13 January 2027.");
  expect(text()).toContain("Keep my plan");
});
