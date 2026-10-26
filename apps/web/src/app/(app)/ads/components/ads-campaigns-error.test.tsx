import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsCampaignsError } from "./ads-campaigns-error";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderError(kind: "not_active" | "unavailable" | "failed") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsCampaignsError
        kind={kind}
        projectId="project-1"
        provider="google_ads"
      />
    </NextIntlClientProvider>,
  );
}

describe("AdsCampaignsError", () => {
  it("sends an inactive connection to Accounts, keeping the project", () => {
    renderError("not_active");

    expect(
      screen.getByText("Reconnect this account in Accounts"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to accounts" }),
    ).toHaveAttribute("href", "/ads?projectId=project-1&tab=accounts");
  });

  it("names the provider that is not set up", () => {
    renderError("unavailable");

    expect(screen.getByText("Google Ads isn't available yet")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers to try again on any other failure", async () => {
    const user = userEvent.setup();
    renderError("failed");

    expect(screen.getByText("Failed to load campaigns")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshMock).toHaveBeenCalled();
  });
});
