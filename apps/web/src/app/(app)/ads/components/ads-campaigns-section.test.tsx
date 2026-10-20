import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listCampaignsMock } = vi.hoisted(() => ({
  listCampaignsMock: vi.fn(),
}));

vi.mock("@/lib/services/ads.service", () => ({
  adsService: { listCampaigns: listCampaignsMock },
}));

// The real error class, so `instanceof` and `status` behave as in the app.
vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

vi.mock("./ads-campaigns", () => ({
  AdsCampaigns: ({
    campaigns,
    currency,
  }: {
    campaigns: unknown[];
    currency: string;
  }) => <div data-testid="campaigns">{`${campaigns.length} ${currency}`}</div>,
}));

vi.mock("./ads-campaigns-error", () => ({
  AdsCampaignsError: ({ kind }: { kind: string }) => (
    <div data-testid="error">{kind}</div>
  ),
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsCampaignsSection } from "./ads-campaigns-section";

const ACCOUNT = { id: "account-1", provider: "google_ads" } as never;

async function renderSection() {
  render(
    await AdsCampaignsSection({
      account: ACCOUNT,
      projectId: "project-1",
      range: "7d",
    }),
  );
}

describe("AdsCampaignsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the account's campaigns for the range", async () => {
    listCampaignsMock.mockResolvedValue({
      campaigns: [{ id: "1" }],
      currency: "EUR",
      range: "LAST_7_DAYS",
    });

    await renderSection();

    expect(listCampaignsMock).toHaveBeenCalledWith(
      "project-1",
      "account-1",
      "LAST_7_DAYS",
    );
    expect(screen.getByTestId("campaigns")).toHaveTextContent("1 EUR");
  });

  it.each([
    [{ status: 409 }, "not_active"],
    [{ status: 503, kind: "integration_not_configured" }, "unavailable"],
    [{ status: 502 }, "failed"],
    [{ status: 503 }, "failed"],
  ])("maps %o to %s", async (details, kind) => {
    listCampaignsMock.mockRejectedValue(new CoreApiRequestError("x", details));

    await renderSection();

    expect(screen.getByTestId("error")).toHaveTextContent(kind);
  });

  it("lets other errors reach the route's error boundary", async () => {
    listCampaignsMock.mockRejectedValue(new Error("redirect"));

    await expect(renderSection()).rejects.toThrow("redirect");
  });
});
