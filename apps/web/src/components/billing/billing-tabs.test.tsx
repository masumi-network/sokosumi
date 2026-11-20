import { render, screen, waitFor } from "@testing-library/react";
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
  const result = render(
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
  return {
    onUrlUpdate,
    rerenderShowCredits: (nextShowCreditsTab: boolean) =>
      result.rerender(
        <NuqsTestingAdapter
          searchParams={searchParams}
          onUrlUpdate={onUrlUpdate}
          hasMemory
        >
          <BillingTabs
            showCreditsTab={nextShowCreditsTab}
            subscriptionContent={<div>Subscription panel</div>}
            creditsContent={<div>Credits panel</div>}
            couponContent={<div>Coupon panel</div>}
            tabLabels={TAB_LABELS}
          />
        </NuqsTestingAdapter>,
      ),
  };
}

describe("BillingTabs", () => {
  it("falls back to subscription and cleans up an invalid tab query parameter", async () => {
    const { onUrlUpdate } = renderBillingTabs("?tab=unknown", true);

    expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Subscription panel")).toBeVisible();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBeNull();
  });

  it("falls back to subscription and cleans up the URL when credits tab is disabled", async () => {
    const { onUrlUpdate } = renderBillingTabs("?tab=credits", false);

    expect(screen.queryByRole("tab", { name: "Credits" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Subscription panel")).toBeVisible();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBeNull();
  });

  it("falls back to subscription and cleans the URL when showCreditsTab turns false while credits is selected", async () => {
    const { onUrlUpdate, rerenderShowCredits } = renderBillingTabs(
      "?tab=credits",
      true,
    );

    expect(screen.getByRole("tab", { name: "Credits" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Credits panel")).toBeVisible();

    rerenderShowCredits(false);

    expect(screen.queryByRole("tab", { name: "Credits" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Subscription panel")).toBeVisible();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBeNull();
  });

  it("switches to another enabled tab on click", async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderBillingTabs("?tab=credits", true);

    expect(screen.getByText("Credits panel")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Coupon" }));

    expect(screen.getByText("Coupon panel")).toBeVisible();
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBe(
      "coupon",
    );
  });
});
