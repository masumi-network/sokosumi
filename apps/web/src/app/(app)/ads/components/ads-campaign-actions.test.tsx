import type { AdCampaign } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateAdCampaign } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsCampaignActions } from "./ads-campaign-actions";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/ads/action", () => ({ updateAdCampaign: vi.fn() }));

const updateMock = vi.mocked(updateAdCampaign);

const ACTIVE: AdCampaign = {
  id: "1",
  name: "Spring sale",
  status: "ACTIVE",
  objective: "SEARCH",
  dailyBudget: 25,
  spend: 0,
  impressions: 0,
  clicks: 0,
  ctr: null,
  cpc: null,
  conversions: null,
};
const PAUSED: AdCampaign = {
  ...ACTIVE,
  id: "2",
  name: "Winter promo",
  status: "PAUSED",
  dailyBudget: null,
};
const ENDED: AdCampaign = {
  ...ACTIVE,
  id: "3",
  name: "Old one",
  status: "ENDED",
};

function renderActions(campaign: AdCampaign = ACTIVE, currency = "USD") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsCampaignActions
        accountId="account-1"
        campaign={campaign}
        currency={currency}
        projectId="project-1"
        provider="google_ads"
      />
    </NextIntlClientProvider>,
  );
}

async function choose(campaign: AdCampaign, item: string, currency = "USD") {
  const user = userEvent.setup();
  renderActions(campaign, currency);
  await user.click(
    screen.getByRole("button", { name: `Actions for ${campaign.name}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: item }));
  return user;
}

describe("AdsCampaignActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [ACTIVE, ["Pause", "Change daily budget"]],
    [PAUSED, ["Resume", "Change daily budget"]],
    [ENDED, ["Change daily budget"]],
  ])("offers only what %o allows", async (campaign, items) => {
    const user = userEvent.setup();
    renderActions(campaign);

    await user.click(
      screen.getByRole("button", { name: `Actions for ${campaign.name}` }),
    );

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(items);
  });

  describe("pause and resume", () => {
    it("asks first and changes nothing until confirmed", async () => {
      await choose(ACTIVE, "Pause");

      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText("Pause Spring sale?")).toBeVisible();
      expect(
        within(dialog).getByText("It stops spending until you resume it."),
      ).toBeVisible();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("cancels without calling Core", async () => {
      const user = await choose(ACTIVE, "Pause");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(updateMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("pauses on confirm and says so", async () => {
      updateMock.mockResolvedValue({ ok: true, value: undefined });
      const user = await choose(ACTIVE, "Pause");

      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Pause",
        }),
      );

      await waitFor(() =>
        expect(toastSuccessMock).toHaveBeenCalledWith(
          "Campaign updated successfully",
        ),
      );
      expect(updateMock).toHaveBeenCalledWith({
        projectId: "project-1",
        accountId: "account-1",
        campaignId: "1",
        status: "PAUSED",
      });
    });

    it("reports a failure", async () => {
      updateMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "Core text" },
      });
      const user = await choose(ACTIVE, "Pause");

      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Pause",
        }),
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to update campaign",
        ),
      );
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("resumes a paused campaign", async () => {
      updateMock.mockResolvedValue({ ok: true, value: undefined });
      const user = await choose(PAUSED, "Resume");

      expect(screen.getByText("Resume Winter promo?")).toBeVisible();
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Resume",
        }),
      );

      await waitFor(() =>
        expect(updateMock).toHaveBeenCalledWith(
          expect.objectContaining({ campaignId: "2", status: "ACTIVE" }),
        ),
      );
    });
  });

  describe("daily budget", () => {
    async function openBudget(currency = "USD", campaign = ACTIVE) {
      const user = await choose(campaign, "Change daily budget", currency);
      const input = screen.getByLabelText(`Daily budget (${currency})`);
      return { user, input };
    }
    const save = () => screen.getByRole("button", { name: "Save budget" });

    it("starts from the current budget and steps by the currency's unit", async () => {
      const { input } = await openBudget();

      expect(input).toHaveValue(25);
      expect(input).toHaveAttribute("step", "0.01");
    });

    it("steps by whole units for JPY", async () => {
      const { input } = await openBudget("JPY");

      expect(input).toHaveAttribute("step", "1");
    });

    it("disables saving while the budget is unchanged", async () => {
      const { user, input } = await openBudget();

      expect(save()).toBeDisabled();
      expect(screen.queryByRole("status")).toBeNull();

      await user.clear(input);
      await user.type(input, "30");
      expect(save()).toBeEnabled();

      await user.clear(input);
      await user.type(input, "25");
      expect(save()).toBeDisabled();
    });

    it("states the change before saving", async () => {
      const { user, input } = await openBudget();

      await user.clear(input);
      await user.type(input, "40.5");

      expect(screen.getByRole("status")).toHaveTextContent(
        "Daily budget changes from $25.00 to $40.50.",
      );
    });

    it("says not set when there was no budget", async () => {
      const { user, input } = await openBudget("USD", PAUSED);

      await user.type(input, "10");

      expect(screen.getByRole("status")).toHaveTextContent(
        "Daily budget changes from not set to $10.00.",
      );
    });

    it.each([
      ["nothing", "", "Enter a daily budget greater than 0."],
      ["zero", "0", "Enter a daily budget greater than 0."],
      ["a negative number", "-3", "Enter a daily budget greater than 0."],
      ["too many decimals", "10.005", "Use at most 2 decimal places for USD."],
    ])("rejects %s without calling Core", async (_name, typed, message) => {
      const { user, input } = await openBudget();

      await user.clear(input);
      if (typed) await user.type(input, typed);
      await user.click(save());

      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("rejects decimals for a currency without any", async () => {
      const { user, input } = await openBudget("JPY");

      await user.clear(input);
      await user.type(input, "10.5");
      await user.click(save());

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Use a whole number for JPY.",
      );
    });

    it("saves the new budget, says so and closes", async () => {
      updateMock.mockResolvedValue({ ok: true, value: undefined });
      const { user, input } = await openBudget();

      await user.clear(input);
      await user.type(input, "40.5");
      await user.click(save());

      await waitFor(() =>
        expect(updateMock).toHaveBeenCalledWith({
          projectId: "project-1",
          accountId: "account-1",
          campaignId: "1",
          dailyBudget: 40.5,
        }),
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Campaign updated successfully",
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    async function saveRefused(error: {
      code: string;
      message: string;
      status?: number;
    }) {
      updateMock.mockResolvedValue({ ok: false, error });
      const { user, input } = await openBudget();
      await user.clear(input);
      await user.type(input, "40");
      await user.click(save());
      return screen.findByRole("alert");
    }

    it("explains a shared or ad-set budget in our words on 409", async () => {
      const alert = await saveRefused({
        code: "BAD_INPUT",
        status: 409,
        message: "Budget shared with 2 other campaigns",
      });

      expect(alert).toHaveTextContent(
        "This campaign's budget is managed in Google Ads (shared or ad-set budget). Change it there.",
      );
      expect(alert).not.toHaveTextContent("Budget shared");
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("explains the precision limit in our words on 422", async () => {
      const alert = await saveRefused({
        code: "BAD_INPUT",
        status: 422,
        message: "dailyBudget has too many decimals",
      });

      expect(alert).toHaveTextContent("Use at most 2 decimal places for USD.");
      expect(alert).not.toHaveTextContent("dailyBudget");
    });

    it("never shows Core's text for other failures", async () => {
      const alert = await saveRefused({
        code: "INTERNAL_SERVER_ERROR",
        status: 502,
        message: "Google exploded",
      });

      expect(alert).toHaveTextContent("Failed to update campaign");
      expect(alert).not.toHaveTextContent("Google exploded");
    });
  });
});
