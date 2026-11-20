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
  it("shows the three monthly plans by name, price and monthly credits, cheapest first", async () => {
    await render();
    expect(cards()).toHaveLength(3);
    expect(cards()[0]).toContain("Starter");
    expect(cards()[0]).toContain("$200");
    expect(cards()[0]).toContain("10,000 credits a month");
    expect(cards()[1]).toContain("$500");
    expect(cards()[1]).toContain("25,000 credits a month");
    expect(cards()[2]).toContain("$1,000");
    expect(cards()[2]).toContain("50,000 credits a month");
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
    expect(cards()[2]).toContain("our team checks every post");
    expect(cards()[1]).not.toContain("our team checks every post");
  });

  it("counts a video shown on several networks once, and leaves skipped pieces out", async () => {
    const base = planAt("active");
    await render({
      plan: {
        ...base,
        calendar: [
          ...base.calendar,
          {
            id: "vid@youtube",
            date: "2026-10-08",
            channel: "youtube",
            title: "Liftoff",
            format: "short",
            status: "idea",
            videoOf: "vid",
          },
          {
            id: "ad-1",
            date: "2026-10-09",
            channel: "google_ads",
            title: "Try it",
            format: "search_ad",
            status: "skipped",
          },
        ],
      },
    });
    const gets = container.querySelector(".ob-gets")?.textContent ?? "";
    expect(gets).toContain("1 picture and 1 video");
    expect(gets).toContain("6 posts");
    expect(gets).not.toContain("Google Ads");
  });

  it("says what the approved month holds before the price", async () => {
    await render({ plan: planAt("active") });
    const gets = container.querySelector(".ob-gets")?.textContent ?? "";
    expect(gets).toContain("5 posts");
    expect(gets).toContain("1 picture and 1 video");
  });

  it("names the month's search ads apart from its posts", async () => {
    const posts = planAt("steady");
    const ad = (id: string) => ({
      id,
      date: "2026-10-09",
      channel: "google_ads",
      title: `Search ad ${id}`,
      format: "search ad",
      status: "idea" as const,
    });
    await render({
      plan: { ...posts, calendar: [...posts.calendar, ad("a1"), ad("a2")] },
    });
    const count = posts.calendar.length;
    expect(text()).toContain(`${count} posts from your strategy`);
    expect(text()).not.toContain("Google Ads, written in your voice");
    expect(text()).toContain("2 ads, live only when you launch them");
  });

  it("says what each plan makes of the strategy, and marks the smallest that makes all of it", async () => {
    // Three X posts a day for a week: Starter makes one a day, Growth two, Scale three.
    const week: Strategy = {
      ...strategy,
      channels: [{ channel: "x", cadence: "3 a day", role: "main" }],
      calendar: Array.from({ length: 7 }, (_, day) =>
        ["a", "b", "c"].map((slot, place) => ({
          id: `x-${day}-${slot}`,
          date: `2026-10-${String(5 + day).padStart(2, "0")}`,
          channel: "x",
          title: `Post ${day} ${slot}`,
          format: place === 2 ? "image" : "post",
          status: "idea" as const,
        })),
      ).flat(),
    };
    await render({ plan: week });
    expect(cards()[0]).toContain(
      "7 posts, 0 pictures and 0 videos a month from your strategy",
    );
    expect(cards()[1]).toContain(
      "14 posts, 0 pictures and 0 videos a month from your strategy",
    );
    expect(cards()[2]).toContain(
      "21 posts, 7 pictures and 0 videos a month from your strategy",
    );
    expect(cards()[2]).toContain("Makes all of it");
    expect(cards()[1]).not.toContain("Makes all of it");
    expect(button("Start Scale for $1,000 a month")).toBeTruthy();
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
    expect(button("Start Starter for $200 a month")).toBeTruthy();
  });

  it("checks out the plan the person picks, over the one marked", async () => {
    const onCheckout = vi.fn(async () => ({ url: null, error: null }));
    await render({ plan: planAt("all_in"), onCheckout });
    // A small month: Starter already makes all of it.
    expect(cards()[0]).toContain("Makes all of it");
    await act(async () =>
      container.querySelectorAll<HTMLElement>(".ob-plan-option")[2]?.click(),
    );
    expect(button("Start Scale for $1,000 a month")).toBeTruthy();
    await press("Start Scale");
    expect(onCheckout).toHaveBeenCalledWith("month", "scale");
  });

  it("shows the yearly saving and the yearly price per month", async () => {
    await render();
    expect(button("Yearly").textContent).toBe("Yearly · save 17%");
    await press("Yearly");
    expect(button("Yearly").getAttribute("aria-pressed")).toBe("true");
    expect(cards()[0]).toContain("$167 a month");
    expect(cards()[0]).toContain("$2,000 billed once a year");
    expect(cards()[0]).toContain("10,000 credits a month");
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
    expect(onCheckout).toHaveBeenCalledWith("month", "starter");
  });

  it("names only what is true about paying", async () => {
    await render();
    expect(text()).toContain("Change or cancel any time in Settings");
    expect(text()).toContain("Discount codes work at checkout");
    expect(text()).toContain(
      "Nothing goes out until you connect your accounts",
    );
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
