import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { AdsTabs } from "./ads-tabs";

function renderTabs(searchParams = "") {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <AdsTabs />
    </NuqsTestingAdapter>,
  );
}

describe("AdsTabs", () => {
  it("offers Campaigns, Market and Accounts, opening on Campaigns", () => {
    renderTabs();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "tabs.campaigns",
      "tabs.market",
      "tabs.accounts",
    ]);
    expect(screen.getByRole("tab", { name: "tabs.campaigns" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("campaigns.emptyTitle")).toBeVisible();
  });

  it.each([
    ["market", "market.emptyTitle"],
    ["accounts", "accounts.emptyTitle"],
  ])("opens the %s tab the URL names", (tab, title) => {
    renderTabs(`?tab=${tab}`);

    expect(screen.getByText(title)).toBeVisible();
  });

  it("falls back to Campaigns for a tab it does not have", () => {
    renderTabs("?tab=bogus");

    expect(screen.getByRole("tab", { name: "tabs.campaigns" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("campaigns.emptyTitle")).toBeVisible();
  });

  it("switches tabs by click", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: "tabs.market" }));

    expect(screen.getByText("market.emptyTitle")).toBeVisible();
  });

  it("sends Campaigns' empty state on to Accounts", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(
      screen.getByRole("button", { name: "campaigns.emptyAction" }),
    );

    expect(screen.getByText("accounts.emptyTitle")).toBeVisible();
  });
});
