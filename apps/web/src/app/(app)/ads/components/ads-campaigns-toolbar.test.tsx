import type { ProjectAdAccount } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/actions/ads/action", () => ({ createAdCampaign: vi.fn() }));

import messages from "../../../../../messages/en.json";
import { AdsCampaignsToolbar } from "./ads-campaigns-toolbar";

const ACCOUNTS = [
  { id: "a1", name: "Main", currency: "USD", provider: "google_ads" },
  { id: "a2", name: "Second", currency: "EUR", provider: "meta_ads" },
] as ProjectAdAccount[];

function renderToolbar(
  accounts: ProjectAdAccount[],
  range: "7d" | "30d" = "30d",
  accountId = accounts[0]?.id ?? "none",
) {
  const onUrlUpdate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <AdsCampaignsToolbar
          accountId={accountId}
          accounts={accounts}
          projectId="project-1"
          range={range}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
  return onUrlUpdate;
}

describe("AdsCampaignsToolbar", () => {
  it("hides the account switcher with a single account", () => {
    renderToolbar([ACCOUNTS[0]]);

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers the account switcher from two accounts", () => {
    renderToolbar(ACCOUNTS);

    expect(
      screen.getByRole("combobox", { name: "Ad account" }),
    ).toHaveTextContent("Main");
  });

  it("marks the current range and writes a new one to the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderToolbar(ACCOUNTS);

    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "7 days" }));

    expect(onUrlUpdate.mock.calls[0][0].searchParams.get("range")).toBe("7d");
  });

  it("keeps the selected range when it is clicked again", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderToolbar(ACCOUNTS);

    await user.click(screen.getByRole("radio", { name: "30 days" }));

    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("offers New campaign while an account is selected", () => {
    renderToolbar(ACCOUNTS);

    expect(screen.getByRole("button", { name: "New campaign" })).toBeVisible();
  });

  it("offers no New campaign without a selected account", () => {
    renderToolbar([]);
    expect(screen.queryByRole("button", { name: "New campaign" })).toBeNull();
  });
});
