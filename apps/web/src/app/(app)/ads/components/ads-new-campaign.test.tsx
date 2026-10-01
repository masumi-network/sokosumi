import type { ProjectAdProvider } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdCampaign } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsNewCampaign } from "./ads-new-campaign";

const { toastSuccessMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccessMock(...args) },
}));
vi.mock("@/lib/actions/ads/action", () => ({ createAdCampaign: vi.fn() }));

const createMock = vi.mocked(createAdCampaign);

type CreateResult = Awaited<ReturnType<typeof createAdCampaign>>;

/** Core's refusal as the action reports it: a code and the HTTP status. */
function refused(status?: number): CreateResult {
  return {
    ok: false,
    error: { code: "INTERNAL_SERVER_ERROR", message: "Core text", status },
  };
}

async function openDialog(
  provider: ProjectAdProvider = "google_ads",
  currency = "USD",
) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsNewCampaign
        accountId="account-1"
        currency={currency}
        projectId="project-1"
        provider={provider}
      />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "New campaign" }));
  await screen.findByRole("dialog");
  return user;
}

const nameInput = () => screen.getByLabelText("Name");
const budgetInput = (currency = "USD") =>
  screen.getByLabelText(`Daily budget (${currency})`);
const submit = () => screen.getByRole("button", { name: "Create campaign" });

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  budget: string,
) {
  await user.type(nameInput(), name);
  await user.type(budgetInput(), budget);
}

describe("AdsNewCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      "google_ads" as const,
      "Campaigns are created paused. Add ad groups and ads in Google Ads, then resume here.",
    ],
    [
      "meta_ads" as const,
      "Campaigns are created paused. Add ad sets and ads in Meta Ads Manager, then resume here.",
    ],
  ])(
    "opens a dialog that says %s campaigns are paused",
    async (provider, note) => {
      await openDialog(provider);

      expect(screen.getByRole("dialog")).toBeVisible();
      expect(screen.getByText(note)).toBeVisible();
    },
  );

  it("has no objective field for Google", async () => {
    await openDialog("google_ads");

    expect(screen.queryByLabelText("Objective")).toBeNull();
  });

  it("steps the budget by the currency's unit", async () => {
    await openDialog("google_ads", "JPY");

    expect(budgetInput("JPY")).toHaveAttribute("step", "1");
  });

  describe("validation", () => {
    it("asks for a name and a budget, calling nothing", async () => {
      const user = await openDialog();

      await user.click(submit());

      expect(await screen.findByText("Enter a name.")).toBeVisible();
      expect(
        screen.getByText("Enter a daily budget greater than 0."),
      ).toBeVisible();
      expect(nameInput()).toHaveAttribute("aria-invalid", "true");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects a blank name", async () => {
      const user = await openDialog();

      await fill(user, "   ", "10");
      await user.click(submit());

      expect(await screen.findByText("Enter a name.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects a budget of 0", async () => {
      const user = await openDialog();

      await fill(user, "Spring sale", "0");
      await user.click(submit());

      expect(
        await screen.findByText("Enter a daily budget greater than 0."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects more decimals than the currency allows", async () => {
      const user = await openDialog();

      await fill(user, "Spring sale", "10.005");
      await user.click(submit());

      expect(
        await screen.findByText("Use at most 2 decimal places for USD."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("asks for a whole number in JPY", async () => {
      const user = await openDialog("google_ads", "JPY");

      await user.type(nameInput(), "Spring sale");
      await user.type(budgetInput("JPY"), "500.5");
      await user.click(submit());

      expect(
        await screen.findByText("Use a whole number for JPY."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("requires an objective for Meta", async () => {
      const user = await openDialog("meta_ads");

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(await screen.findByText("Choose an objective.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("submit", () => {
    it("creates a Google campaign with no objective, then closes and says so", async () => {
      createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
      const user = await openDialog();

      await fill(user, "  Spring sale ", "25.5");
      await user.click(submit());

      await waitFor(() =>
        expect(toastSuccessMock).toHaveBeenCalledWith(
          "Campaign created successfully",
        ),
      );
      expect(createMock).toHaveBeenCalledWith({
        projectId: "project-1",
        accountId: "account-1",
        name: "Spring sale",
        dailyBudget: 25.5,
        objective: undefined,
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("sends the chosen objective for Meta", async () => {
      createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
      const user = await openDialog("meta_ads");

      await fill(user, "Spring sale", "10");
      await user.click(screen.getByRole("combobox", { name: "Objective" }));
      await user.click(screen.getByRole("option", { name: "Leads" }));
      await user.click(submit());

      await waitFor(() =>
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({ objective: "OUTCOME_LEADS" }),
        ),
      );
    });

    it("tells the precision on 422 and keeps the dialog open", async () => {
      createMock.mockResolvedValue(refused(422));
      const user = await openDialog();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Use at most 2 decimal places for USD."),
      ).toBeVisible();
      expect(screen.queryByText("Core text")).toBeNull();
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(nameInput()).toHaveValue("Spring sale");
    });

    it("asks to reconnect on 409, with a link to Accounts", async () => {
      createMock.mockResolvedValue(refused(409));
      const user = await openDialog();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Reconnect this account in Accounts");
      expect(
        within(alert).getByRole("link", { name: "Go to accounts" }),
      ).toHaveAttribute("href", "/ads?projectId=project-1&tab=accounts");
      expect(screen.queryByText("Core text")).toBeNull();
    });

    it.each([[undefined], [502]])(
      "shows a generic message for a Core failure (status %s)",
      async (status) => {
        createMock.mockResolvedValue(refused(status));
        const user = await openDialog();

        await fill(user, "Spring sale", "10");
        await user.click(submit());

        expect(
          await screen.findByText("Failed to create campaign"),
        ).toBeVisible();
        expect(screen.queryByText("Core text")).toBeNull();
        expect(toastSuccessMock).not.toHaveBeenCalled();
      },
    );

    it("shows the generic message when the action throws", async () => {
      createMock.mockRejectedValue(new Error("network"));
      const user = await openDialog();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Failed to create campaign"),
      ).toBeVisible();
    });
  });
});
