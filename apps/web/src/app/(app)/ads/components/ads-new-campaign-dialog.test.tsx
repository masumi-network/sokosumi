import type { ProjectAdAccount } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGoogleCampaignSetup } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";

vi.mock("@/lib/actions/ads/action", () => ({
  getGoogleCampaignSetup: vi.fn(),
}));

vi.mock("./ads-campaign-wizard", () => {
  const Wizard =
    (kind: string) =>
    ({
      accountLabel,
      hasMarketProfile,
      onBusyChange,
      onClose,
    }: {
      accountLabel: string;
      hasMarketProfile?: boolean;
      onBusyChange: (busy: boolean) => void;
      onClose: () => void;
    }) => (
      <div>
        <p>{`${kind} wizard: ${accountLabel}`}</p>
        {hasMarketProfile ? <p>with market profile</p> : null}
        <button onClick={() => onBusyChange(true)} type="button">
          start saving
        </button>
        <button onClick={onClose} type="button">
          wizard cancel
        </button>
      </div>
    );
  return {
    NewGoogleCampaignWizard: Wizard("google"),
    NewMetaCampaignWizard: Wizard("meta"),
    WizardSkeleton: () => (
      <div aria-busy="true" role="status">
        wizard skeleton
      </div>
    ),
  };
});

import { AdsNewCampaignDialog } from "./ads-new-campaign-dialog";

const setupMock = vi.mocked(getGoogleCampaignSetup);
type SetupResult = Awaited<ReturnType<typeof getGoogleCampaignSetup>>;

const GOOGLE = {
  id: "a1",
  name: "Main",
  currency: "EUR",
  provider: "google_ads",
} as ProjectAdAccount;
const META = { ...GOOGLE, id: "a2", provider: "meta_ads" } as ProjectAdAccount;

const SETUP = {
  hasMarketProfile: true,
  targeting: {
    languageOptions: [],
    defaultLocations: [],
    defaultLanguages: [],
  },
};

function renderDialog(account: ProjectAdAccount) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdsNewCampaignDialog
          account={account}
          onClose={onClose}
          projectId="project-1"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose, user };
}

describe("AdsNewCampaignDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the wizard's shape while the Google setup loads, then the wizard", async () => {
    const setup = Promise.withResolvers<SetupResult>();
    setupMock.mockReturnValue(setup.promise);
    renderDialog(GOOGLE);

    expect(screen.getByRole("dialog", { name: "New campaign" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(setupMock).toHaveBeenCalledWith({
      projectId: "project-1",
      accountId: "a1",
    });

    setup.resolve({ ok: true, value: SETUP });
    expect(
      await screen.findByText("google wizard: Google Ads account Main"),
    ).toBeVisible();
    expect(screen.getByText("with market profile")).toBeVisible();
  });

  it("offers to try again when the setup fails", async () => {
    setupMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "down" },
    });
    setupMock.mockResolvedValueOnce({ ok: true, value: SETUP });
    const { user } = renderDialog(GOOGLE);

    expect(
      await screen.findByText("Failed to load the campaign form"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByText("google wizard: Google Ads account Main"),
    ).toBeVisible();
  });

  it("opens the Meta wizard at once, loading nothing", () => {
    renderDialog(META);

    expect(
      screen.getByText("meta wizard: Meta Ads account Main"),
    ).toBeVisible();
    expect(setupMock).not.toHaveBeenCalled();
  });

  it("closes on Escape and from the wizard", async () => {
    const { onClose, user } = renderDialog(META);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "wizard cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stays open on Escape while the campaign is being saved", async () => {
    const { onClose, user } = renderDialog(META);

    await user.click(screen.getByRole("button", { name: "start saving" }));
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });
});
