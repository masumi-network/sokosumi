import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { pathnameState, replaceMock } = vi.hoisted(() => ({
  pathnameState: { value: "/ads/campaigns/42/edit" },
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useRouter: () => ({ replace: replaceMock }),
}));

// The wizard has its own tests; here it can close the modal or hold it busy.
vi.mock("./ads-campaign-wizard", () => ({
  EditGoogleCampaignWizard: ({
    accountLabel,
    onBusyChange,
    onClose,
  }: {
    accountLabel: string;
    onBusyChange: (busy: boolean) => void;
    onClose: () => void;
  }) => (
    <div>
      <p>{`edit wizard: ${accountLabel}`}</p>
      <button onClick={() => onBusyChange(true)} type="button">
        start saving
      </button>
      <button onClick={onClose} type="button">
        saved
      </button>
    </div>
  ),
  WizardSkeleton: () => <div role="status">wizard skeleton</div>,
}));

import {
  AdsEditCampaignModal,
  type EditCampaignData,
} from "./ads-edit-campaign-modal";

const CAMPAIGN = {
  accountId: "a1",
  accountLabel: "Google Ads account Main",
  campaignId: "42",
} as EditCampaignData;

function renderModal(props: Parameters<typeof AdsEditCampaignModal>[0]) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsEditCampaignModal {...props} />
    </NextIntlClientProvider>,
  );
  return user;
}

describe("AdsEditCampaignModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameState.value = "/ads/campaigns/42/edit";
    window.history.replaceState(
      null,
      "",
      "/?projectId=p1&accountId=a1&range=7d",
    );
  });

  it("opens the edit wizard under the Edit campaign title", () => {
    renderModal({ campaign: CAMPAIGN });

    expect(screen.getByRole("dialog", { name: "Edit campaign" })).toBeVisible();
    expect(
      screen.getByText("edit wizard: Google Ads account Main"),
    ).toBeVisible();
  });

  it("goes back to the details, keeping the query, on Cancel and after a save", async () => {
    const user = renderModal({ campaign: CAMPAIGN });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "saved" }));

    expect(replaceMock).toHaveBeenNthCalledWith(
      1,
      "/ads/campaigns/42?projectId=p1&accountId=a1&range=7d",
    );
    expect(replaceMock).toHaveBeenNthCalledWith(
      2,
      "/ads/campaigns/42?projectId=p1&accountId=a1&range=7d",
    );
  });

  it("stays open on Escape while the campaign is being saved", async () => {
    const user = renderModal({ campaign: CAMPAIGN });

    await user.click(screen.getByRole("button", { name: "start saving" }));
    await user.keyboard("{Escape}");

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("is closed once the URL has left the edit route", () => {
    pathnameState.value = "/ads/campaigns/42";
    renderModal({ campaign: CAMPAIGN });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a notice instead of the wizard", () => {
    renderModal({ notice: <p>This campaign can't be edited here.</p> });

    expect(
      screen.getByText("This campaign can't be edited here."),
    ).toBeVisible();
    expect(screen.queryByText(/edit wizard/)).toBeNull();
  });

  it("holds the wizard's shape while the route loads", () => {
    renderModal({ loading: true });

    expect(screen.getByRole("status")).toHaveTextContent("wizard skeleton");
  });
});
