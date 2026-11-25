// @vitest-environment happy-dom

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoPlans } from "../../test-fixtures/cmo";
import { strategy } from "../../test-fixtures/onboarding";
import { CheckoutStep } from "./checkout-step";

type Strategy = NonNullable<CmoOverview["strategy"]>;

let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  assign.mockReset();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const text = () => container.textContent ?? "";
const cards = () =>
  [...container.querySelectorAll<HTMLElement>(".ob-plan-option")].map(
    (card) => card.textContent ?? "",
  );

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(label),
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}
const press = (label: string) => act(async () => button(label).click());

/** The fixture plan at a pace, with a picture post and a video added. */
const planAt = (level: "steady" | "active" | "all_in"): Strategy => ({
  ...strategy,
  pace: { level, why: "Fits", perWeek: 7 },
  calendar: [
    ...strategy.calendar,
    {
      id: "img",
      date: "2026-10-07",
      channel: "x",
      title: "The rocket up close",
      format: "image",
      status: "idea",
    },
    {
      id: "vid",
      date: "2026-10-08",
      channel: "linkedin",
      title: "Liftoff",
      format: "video",
      status: "idea",
    },
  ],
});

interface Rendered {
  plans?: CmoSubscriptionPlan[];
  phase?: "choosing" | "confirming";
  plan?: Strategy | null;
  onCheckout?: (
    interval: "month" | "year",
    tier: string,
  ) => Promise<{ url: string | null; error: string | null }>;
  onShowPlans?: () => void;
}

async function render({
  plans = cmoPlans,
  phase = "choosing",
  plan = null,
  onCheckout = async () => ({ url: null, error: null }),
  onShowPlans = () => {},
}: Rendered = {}) {
  await act(async () =>
    root.render(
      <CheckoutStep
        plans={plans}
        phase={phase}
        strategy={plan}
        onCheckout={onCheckout}
        onShowPlans={onShowPlans}
      />,
    ),
  );
}

describe("CheckoutStep", () => {
  it("opens on Yearly, with Monthly one tap away", async () => {
    await render();
    expect(button("Yearly").getAttribute("aria-pressed")).toBe("true");
    expect(button("Start Starter for $167 a month")).toBeTruthy();
    await press("Monthly");
    expect(button("Monthly").getAttribute("aria-pressed")).toBe("true");
    expect(button("Start Starter for $200 a month")).toBeTruthy();
  });

  it("opens on Monthly when there is no yearly plan", async () => {
    await render({
      plans: cmoPlans.filter((plan) => plan.interval === "month"),
    });
    expect(button("Monthly").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the three monthly plans by name and price, cheapest first", async () => {
    await render();
    await press("Monthly");
    expect(cards()).toHaveLength(3);
    expect(cards()[0]).toContain("Starter");
    expect(cards()[0]).toContain("$200");
    expect(cards()[1]).toContain("$500");
    expect(cards()[2]).toContain("$1,000");
    expect(text()).not.toContain("(monthly)");
    expect(text()).not.toContain("$2,000");
  });

  it("says what each plan posts as the landing page does, and the team check on the top plan only", async () => {
    await render();
    expect(cards()[0]).toContain("One post a day on each account you connect.");
    expect(cards()[1]).toContain(
      "Two posts a day on each account you connect.",
    );
    expect(cards()[2]).toContain(
      "Up to three posts a day on each account you connect.",
    );
    expect(cards()[2]).toContain("Our team checks every post");
    expect(cards()[1]).not.toContain("Our team checks every post");
  });

  it("shows the month's networks as their marks, without counts or ads", async () => {
    const base = planAt("active");
    await render({
      plan: {
        ...base,
        calendar: [
          ...base.calendar,
          {
            id: "ad-1",
            date: "2026-10-09",
            channel: "google_ads",
            title: "Try it",
            format: "search_ad",
            status: "idea",
          },
        ],
      },
    });
    const row = container.querySelector(".ob-networks-row");
    expect(row?.getAttribute("aria-label")).toContain("X");
    expect(row?.getAttribute("aria-label")).toContain("LinkedIn");
    expect(row?.getAttribute("aria-label")).not.toContain("Google Ads");
    expect(text()).not.toMatch(/\d+ (pictures|videos)/);
  });

  it("shows every network CMO posts on without a strategy", async () => {
    await render();
    expect(container.querySelectorAll(".ob-networks-row li")).toHaveLength(6);
  });

  it("says how many posts each plan makes a month, and marks the smallest that makes all of it", async () => {
    // Six X posts a day for a week: Starter makes three a day, Growth four, Scale six.
    const week: Strategy = {
      ...strategy,
      channels: [{ channel: "x", cadence: "6 a day", role: "main" }],
      calendar: Array.from({ length: 7 }, (_, day) =>
        ["a", "b", "c", "d", "e", "f"].map((slot, place) => ({
          id: `x-${day}-${slot}`,
          date: `2026-10-${String(5 + day).padStart(2, "0")}`,
          channel: "x",
          title: `Post ${day} ${slot}`,
          format: place >= 4 ? "image" : "post",
          status: "idea" as const,
        })),
      ).flat(),
    };
    await render({ plan: week });
    expect(cards()[0]).toContain("About 20 posts a month");
    expect(cards()[1]).toContain("About 30 posts a month");
    expect(cards()[2]).toContain("All 42 posts a month");
    expect(cards()[2]).toContain("Makes all of it");
    expect(cards()[1]).not.toContain("Makes all of it");
    expect(button("Start Scale for $833 a month")).toBeTruthy();
  });

  it("marks the plan that already makes a smaller strategy whole", async () => {
    await render({
      plan: {
        ...strategy,
        channels: [{ channel: "x", cadence: "1 a day", role: "main" }],
        calendar: [
          {
            id: "x-1",
            date: "2026-10-05",
            channel: "x",
            title: "One post",
            format: "post",
            status: "idea",
          },
        ],
      },
    });
    expect(cards()[0]).toContain("Makes all of it");
    expect(button("Start Starter for $167 a month")).toBeTruthy();
  });

  it("checks out the plan the person picks, over the one marked", async () => {
    const onCheckout = vi.fn(async () => ({ url: null, error: null }));
    await render({ plan: planAt("all_in"), onCheckout });
    // A small month: Starter already makes all of it.
    expect(cards()[0]).toContain("Makes all of it");
    await act(async () =>
      container.querySelectorAll<HTMLElement>(".ob-plan-option")[2]?.click(),
    );
    expect(button("Start Scale for $833 a month")).toBeTruthy();
    await press("Start Scale");
    expect(onCheckout).toHaveBeenCalledWith("year", "scale");
  });

  it("shows the yearly saving and the yearly price per month", async () => {
    await render();
    expect(container.querySelector(".ob-save")?.textContent).toBe("Save 17%");
    await press("Yearly");
    expect(button("Yearly").getAttribute("aria-pressed")).toBe("true");
    expect(cards()[0]).toContain("$200");
    expect(cards()[0]).toContain("$167 a month");
    expect(cards()[0]).toContain("$2,000 billed yearly");
    expect(button("Start Starter for $167 a month")).toBeTruthy();
  });

  it("fills the same lines on both intervals, so switching never moves the cards", async () => {
    await render();
    const lines = () =>
      [...container.querySelectorAll(".ob-plan-option")].map(
        (card) => card.children.length,
      );
    const yearly = lines();
    await press("Monthly");
    expect(lines()).toEqual(yearly);
    expect(cards()[0]).toContain("Billed monthly");
  });

  it("says each plan's AI credits a month, on both intervals", async () => {
    await render();
    expect(cards()[0]).toContain("10,000 AI credits a month");
    expect(cards()[1]).toContain("25,000 AI credits a month");
    expect(cards()[2]).toContain("50,000 AI credits a month");
    await press("Monthly");
    expect(cards()[2]).toContain("50,000 AI credits a month");
  });

  it("frames Growth as the start and Scale as everything, Scale standing out unpicked", async () => {
    await render();
    await press("Starter");
    expect(cards()[0]).not.toMatch(/Strong start|Everything included/);
    expect(cards()[1]).toContain("Strong start");
    expect(cards()[2]).toContain("Everything included");
    const top = container.querySelectorAll(".ob-plan-option")[2];
    expect(top?.classList.contains("ob-plan-top")).toBe(true);
    expect(top?.getAttribute("aria-pressed")).toBe("false");
    expect(text()).not.toMatch(/most popular|most picked/i);
  });

  it("sends the person to Polar with the interval and the plan they picked", async () => {
    const onCheckout = vi.fn(async () => ({
      url: "https://polar.sh/checkout/c_1",
      error: null,
    }));
    await render({ onCheckout });
    await press("Yearly");
    await press("Growth");
    await press("Start Growth");
    expect(onCheckout).toHaveBeenCalledWith("year", "growth");
    expect(assign).toHaveBeenCalledWith("https://polar.sh/checkout/c_1");
  });

  it("opens on the cheapest plan without a pace", async () => {
    const onCheckout = vi.fn(async () => ({ url: null, error: null }));
    await render({ onCheckout });
    await press("Start Starter");
    expect(onCheckout).toHaveBeenCalledWith("year", "starter");
  });

  it("keeps the fine print to one line", async () => {
    await render();
    const legal = container.querySelector(".legal-notice");
    expect(legal?.textContent).toContain("Cancel any time.");
    expect(
      [...(legal?.querySelectorAll("a") ?? [])].map((link) => link.textContent),
    ).toEqual(["Terms", "Privacy", "DPA", "Imprint"]);
    expect(text()).not.toContain("Discount codes");
    expect(text()).not.toContain("Polar");
    expect(text()).not.toContain("(testers)");
  });

  it("says why the checkout did not open and stays on the plans", async () => {
    await render({
      onCheckout: async () => ({
        url: null,
        error: "This Cuso already has a CMO subscription",
      }),
    });
    await press("Start Starter");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This Cuso already has a CMO subscription",
    );
    expect(assign).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(3);
  });

  it("says so when the plans could not be read, and offers no payment", async () => {
    await render({ plans: [] });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Plans aren't available right now",
    );
    expect(text()).not.toContain("Start ");
  });

  it("shows that the payment is being confirmed, with a way back to the plans", async () => {
    const onShowPlans = vi.fn();
    await render({ phase: "confirming", onShowPlans });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Confirming your payment",
    );
    expect(cards()).toHaveLength(0);
    await press("I haven't paid");
    expect(onShowPlans).toHaveBeenCalledTimes(1);
  });
});
