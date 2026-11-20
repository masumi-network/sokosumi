import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { BillingTabs } from "./billing-tabs";

const TAB_LABELS = {
  subscription: "Subscription",
  credits: "Credits",
  coupon: "Coupon",
};

function renderBillingTabs(searchParams: string, showCreditsTab: boolean) {
  const onUrlUpdate = vi.fn();
  render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
      hasMemory
    >
      <BillingTabs
        showCreditsTab={showCreditsTab}
        subscriptionContent={<div>Subscription panel</div>}
        creditsContent={<div>Credits panel</div>}
        couponContent={<div>Coupon panel</div>}
        tabLabels={TAB_LABELS}
      />
    </NuqsTestingAdapter>,
  );
  return onUrlUpdate;
}

describe("BillingTabs", () => {
  it("falls back to subscription when the tab query parameter is invalid", () => {
    renderBillingTabs("?tab=unknown", true);

    expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Subscription panel")).toBeVisible();
  });

  it("falls back to subscription when credits tab is disabled", () => {
    renderBillingTabs("?tab=credits", false);

    expect(screen.queryByRole("tab", { name: "Credits" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Subscription panel")).toBeVisible();
  });

  it("switches to another enabled tab on click", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderBillingTabs("?tab=credits", true);

    expect(screen.getByText("Credits panel")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Coupon" }));

    expect(screen.getByText("Coupon panel")).toBeVisible();
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBe(
      "coupon",
    );
  });
});
