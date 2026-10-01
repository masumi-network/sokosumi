import type { AdCampaign } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateAdCampaign } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsCampaigns } from "./ads-campaigns";

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
  spend: 1234.5,
  impressions: 12000,
  clicks: 340,
  ctr: 0.0283,
  cpc: 3.63,
  conversions: 12,
};
const PAUSED: AdCampaign = {
  ...ACTIVE,
  id: "2",
  name: "Winter promo",
  status: "PAUSED",
  objective: null,
  dailyBudget: null,
  ctr: null,
  cpc: null,
  conversions: null,
};
const ENDED: AdCampaign = {
  ...ACTIVE,
  id: "3",
  name: "Old one",
  status: "ENDED",
};

function renderCampaigns(
  campaigns: AdCampaign[] = [ACTIVE, PAUSED],
  currency = "USD",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsCampaigns
        accountId="account-1"
        campaigns={campaigns}
        currency={currency}
        projectId="project-1"
      />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByTestId("ads-campaigns-table"));
const rows = () => within(screen.getByTestId("ads-campaigns-rows"));

describe("AdsCampaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state for an account without campaigns", () => {
    renderCampaigns([]);

    expect(screen.getByText("No campaigns in this account yet")).toBeVisible();
  });

  it("draws every column, with money and CTR formatted and gaps as a dash", () => {
    renderCampaigns();

    for (const column of [
      "Campaign",
      "Status",
      "Daily budget",
      "Spend",
      "Impressions",
      "Clicks",
      "CTR",
      "CPC",
      "Conversions",
    ]) {
      expect(
        table().getByRole("columnheader", { name: column }),
      ).toBeInTheDocument();
    }
    const [, active, paused] = table().getAllByRole("row");
    expect(within(active).getByText("SEARCH")).toBeInTheDocument();
    expect(
      within(active)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Spring saleSEARCH",
      "Active",
      "$25.00",
      "$1,234.50",
      "12,000",
      "340",
      "2.83%",
      "$3.63",
      "12",
      "",
    ]);
    expect(
      within(paused)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Winter promo",
      "Paused",
      "—",
      "$1,234.50",
      "12,000",
      "340",
      "—",
      "—",
      "—",
      "",
    ]);
  });

  it("formats money without decimals for JPY", () => {
    renderCampaigns([ACTIVE], "JPY");

    expect(table().getByText("¥1,235")).toBeInTheDocument();
  });

  it("stacks name, status, spend and clicks on small screens", () => {
    renderCampaigns();

    const [first] = rows().getAllByRole("listitem");
    expect(within(first).getByText("Spring sale")).toBeInTheDocument();
    expect(within(first).getByText("Active")).toBeInTheDocument();
    expect(
      within(first).getByText("Spend $1,234.50 · Clicks 340"),
    ).toBeInTheDocument();
  });

  it("offers pause for active, resume for paused and neither for ended", async () => {
    const user = userEvent.setup();
    renderCampaigns([ACTIVE, PAUSED, ENDED]);

    await user.click(
      table().getByRole("button", { name: "Actions for Spring sale" }),
    );
    expect(screen.getByRole("menuitem", { name: "Pause" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Resume" })).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(
      table().getByRole("button", { name: "Actions for Winter promo" }),
    );
    expect(screen.getByRole("menuitem", { name: "Resume" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Pause" })).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(
      table().getByRole("button", { name: "Actions for Old one" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Resume" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Change daily budget" }),
    ).toBeVisible();
  });

  describe("pause", () => {
    async function openPauseDialog() {
      const user = userEvent.setup();
      renderCampaigns([ACTIVE]);
      await user.click(
        table().getByRole("button", { name: "Actions for Spring sale" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Pause" }));
      return user;
    }

    it("asks first and changes nothing until confirmed", async () => {
      await openPauseDialog();

      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByText("Pause Spring sale?")).toBeVisible();
      expect(
        within(dialog).getByText("It stops spending until you resume it."),
      ).toBeVisible();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("cancels without calling Core", async () => {
      const user = await openPauseDialog();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(updateMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("pauses on confirm and says so", async () => {
      updateMock.mockResolvedValue({ ok: true, value: undefined });
      const user = await openPauseDialog();

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
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
      const user = await openPauseDialog();

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
      const user = userEvent.setup();
      renderCampaigns([PAUSED]);

      await user.click(
        table().getByRole("button", { name: "Actions for Winter promo" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Resume" }));
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
    async function openBudgetDialog(currency = "USD") {
      const user = userEvent.setup();
      renderCampaigns([ACTIVE], currency);
      await user.click(
        table().getByRole("button", { name: "Actions for Spring sale" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: "Change daily budget" }),
      );
      const input = screen.getByLabelText("Daily budget (" + currency + ")");
      return { user, input };
    }

    it("starts from the current budget and steps by the currency's unit", async () => {
      const { input } = await openBudgetDialog();

      expect(input).toHaveValue(25);
      expect(input).toHaveAttribute("step", "0.01");
    });

    it("steps by whole units for JPY", async () => {
      const { input } = await openBudgetDialog("JPY");

      expect(input).toHaveAttribute("step", "1");
    });

    it.each([
      ["nothing", "", "Enter a daily budget greater than 0."],
      ["zero", "0", "Enter a daily budget greater than 0."],
      ["a negative number", "-3", "Enter a daily budget greater than 0."],
      ["too many decimals", "10.005", "Use at most 2 decimal places for USD."],
    ])("rejects %s without calling Core", async (_name, typed, message) => {
      const { user, input } = await openBudgetDialog();

      await user.clear(input);
      if (typed) await user.type(input, typed);
      await user.click(screen.getByRole("button", { name: "Save budget" }));

      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("rejects decimals for a currency without any", async () => {
      const { user, input } = await openBudgetDialog("JPY");

      await user.clear(input);
      await user.type(input, "10.5");
      await user.click(screen.getByRole("button", { name: "Save budget" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Use a whole number for JPY.",
      );
    });

    it("saves the new budget, says so and closes", async () => {
      updateMock.mockResolvedValue({ ok: true, value: undefined });
      const { user, input } = await openBudgetDialog();

      await user.clear(input);
      await user.type(input, "40.5");
      await user.click(screen.getByRole("button", { name: "Save budget" }));

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

    it("shows Core's own message inline and stays open", async () => {
      updateMock.mockResolvedValue({
        ok: false,
        error: {
          code: "BAD_INPUT",
          message: "This budget is shared with 2 other campaigns.",
        },
      });
      const { user } = await openBudgetDialog();

      await user.click(screen.getByRole("button", { name: "Save budget" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This budget is shared with 2 other campaigns.",
      );
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("falls back to a generic message for other failures", async () => {
      updateMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
      });
      const { user } = await openBudgetDialog();

      await user.click(screen.getByRole("button", { name: "Save budget" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Failed to update campaign",
      );
    });
  });
});
