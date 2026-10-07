import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// The Accounts tab has its own tests; here it only has to be the panel shown.
vi.mock("./ads-accounts", () => ({
  AdsAccounts: ({ projectId }: { projectId: string }) => (
    <div>accounts.emptyTitle for {projectId}</div>
  ),
}));

vi.mock("./ads-skeleton", () => ({
  AdsRowsSkeleton: () => <div>rows skeleton</div>,
}));

import type { ProjectAdAccount } from "@sokosumi/core-client";

import { AdsTabs } from "./ads-tabs";

function renderTabs(
  searchParams = "",
  {
    accounts = [],
    campaigns = null,
    market = null,
  }: {
    accounts?: ProjectAdAccount[];
    campaigns?: React.ReactNode;
    market?: React.ReactNode;
  } = {},
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <AdsTabs
        accounts={accounts}
        campaigns={campaigns}
        market={market}
        projectId="project-1"
      />
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

  it("opens the accounts tab the URL names", () => {
    renderTabs("?tab=accounts");

    expect(screen.getByText("accounts.emptyTitle for project-1")).toBeVisible();
  });

  it("shows the server-rendered market on its tab", () => {
    renderTabs("?tab=market", { market: <div>market from the server</div> });

    expect(screen.getByText("market from the server")).toBeVisible();
  });

  it("holds a skeleton while the server sends the market after a tab switch", () => {
    renderTabs("?tab=market");

    expect(screen.getByText("rows skeleton")).toBeVisible();
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

    expect(screen.getByText("rows skeleton")).toBeVisible();
  });

  it("sends Campaigns' empty state on to Accounts", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(
      screen.getByRole("button", { name: "campaigns.emptyAction" }),
    );

    expect(screen.getByText("accounts.emptyTitle for project-1")).toBeVisible();
  });

  it("shows the server-rendered campaigns once an account is connected", () => {
    renderTabs("", {
      accounts: [{ id: "a1" } as ProjectAdAccount],
      campaigns: <div>campaigns from the server</div>,
    });

    expect(screen.getByText("campaigns from the server")).toBeVisible();
    expect(screen.queryByText("campaigns.emptyTitle")).not.toBeInTheDocument();
  });

  it("holds a skeleton while the server sends campaigns after a tab switch", () => {
    renderTabs("", { accounts: [{ id: "a1" } as ProjectAdAccount] });

    expect(screen.getByText("rows skeleton")).toBeVisible();
  });
});
