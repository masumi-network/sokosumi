// @vitest-environment happy-dom

import type { CmoSubscriptionPlan } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmoPlans } from "../../test-fixtures/cmo";
import { CheckoutStep } from "./checkout-step";

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

interface Rendered {
  plans?: CmoSubscriptionPlan[];
  phase?: "choosing" | "confirming";
  onCheckout?: (
    interval: "month" | "year",
    tier: string,
  ) => Promise<{ url: string | null; error: string | null }>;
  onShowPlans?: () => void;
}

async function render({
  plans = cmoPlans,
  phase = "choosing",
  onCheckout = async () => ({ url: null, error: null }),
  onShowPlans = () => {},
}: Rendered = {}) {
  await act(async () =>
    root.render(
      <CheckoutStep
        plans={plans}
        phase={phase}
        onCheckout={onCheckout}
        onShowPlans={onShowPlans}
      />,
    ),
  );
}

describe("CheckoutStep", () => {
  it("shows the three monthly plans with price and monthly credits, cheapest first", async () => {
    await render();
    expect(cards()).toHaveLength(3);
    expect(cards()[0]).toContain("Starter");
    expect(cards()[0]).toContain("$200");
    expect(cards()[0]).toContain("10,000 credits every month");
    expect(cards()[1]).toContain("$500");
    expect(cards()[1]).toContain("25,000 credits every month");
    expect(cards()[2]).toContain("$1,000");
    expect(cards()[2]).toContain("50,000 credits every month");
    expect(text()).not.toContain("$2,000");
  });

  it("switches to the yearly plans, which still grant month by month", async () => {
    await render();
    await press("Yearly");
    expect(button("Yearly").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(3);
    expect(cards()[0]).toContain("$2,000");
    expect(cards()[0]).toContain("a year");
    expect(cards()[0]).toContain("10,000 credits every month");
    expect(cards()[2]).toContain("$10,000");
  });

  it("sends the person to Polar with the interval and the plan they picked", async () => {
    const onCheckout = vi.fn(async () => ({
      url: "https://polar.sh/checkout/c_1",
      error: null,
    }));
    await render({ onCheckout });
    await press("Yearly");
    await press("Growth");
    await press("Continue to payment");
    expect(onCheckout).toHaveBeenCalledWith("year", "growth");
    expect(assign).toHaveBeenCalledWith("https://polar.sh/checkout/c_1");
  });

  it("opens on the cheapest plan of the interval", async () => {
    const onCheckout = vi.fn(async () => ({ url: null, error: null }));
    await render({ onCheckout });
    await press("Continue to payment");
    expect(onCheckout).toHaveBeenCalledWith("month", "starter");
  });

  it("says why the checkout did not open and stays on the plans", async () => {
    await render({
      onCheckout: async () => ({
        url: null,
        error: "This Cuso already has a CMO subscription",
      }),
    });
    await press("Continue to payment");
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
    expect(text()).not.toContain("Continue to payment");
  });

  it("shows that the payment is being confirmed, with a way back to the plans", async () => {
    const onShowPlans = vi.fn();
    await render({ phase: "confirming", onShowPlans });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Confirming your payment",
    );
    expect(cards()).toHaveLength(0);
    expect(text()).not.toContain("Continue to payment");
    await press("I haven't paid");
    expect(onShowPlans).toHaveBeenCalledTimes(1);
  });
});
