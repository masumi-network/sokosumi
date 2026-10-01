import type { ProjectAdProvider } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdCampaign } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsNewCampaign } from "./ads-new-campaign";

const { isMobileMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  isMobileMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: isMobileMock }));
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));
vi.mock("@/lib/actions/ads/action", () => ({ createAdCampaign: vi.fn() }));

const createMock = vi.mocked(createAdCampaign);

async function openSheet(
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
    isMobileMock.mockReturnValue(false);
  });

  it("opens a sheet that says campaigns are created paused", async () => {
    await openSheet();

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByText(
        "Campaigns are created paused. Add ad groups and ads in Google Ads / Meta Ads Manager, then resume here.",
      ),
    ).toBeVisible();
  });

  it("opens from the bottom on mobile", async () => {
    isMobileMock.mockReturnValue(true);
    await openSheet();

    expect(screen.getByRole("dialog")).toHaveClass("inset-x-0", "bottom-0");
  });

  it("has no objective field for Google", async () => {
    await openSheet("google_ads");

    expect(screen.queryByLabelText("Objective")).toBeNull();
  });

  it("steps the budget by the currency's unit", async () => {
    await openSheet("google_ads", "JPY");

    expect(budgetInput("JPY")).toHaveAttribute("step", "1");
  });

  describe("validation", () => {
    it("asks for a name and a budget, calling nothing", async () => {
      const user = await openSheet();

      await user.click(submit());

      expect(screen.getByText("Enter a name.")).toBeVisible();
      expect(
        screen.getByText("Enter a daily budget greater than 0."),
      ).toBeVisible();
      expect(nameInput()).toHaveAttribute("aria-invalid", "true");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects a blank name", async () => {
      const user = await openSheet();

      await fill(user, "   ", "10");
      await user.click(submit());

      expect(screen.getByText("Enter a name.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects a budget of 0", async () => {
      const user = await openSheet();

      await fill(user, "Spring sale", "0");
      await user.click(submit());

      expect(
        screen.getByText("Enter a daily budget greater than 0."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects more decimals than the currency allows", async () => {
      const user = await openSheet();

      await fill(user, "Spring sale", "10.005");
      await user.click(submit());

      expect(
        screen.getByText("Use at most 2 decimal places for USD."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("asks for a whole number in JPY", async () => {
      const user = await openSheet("google_ads", "JPY");

      await user.type(nameInput(), "Spring sale");
      await user.type(budgetInput("JPY"), "500.5");
      await user.click(submit());

      expect(screen.getByText("Use a whole number for JPY.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("requires an objective for Meta", async () => {
      const user = await openSheet("meta_ads");

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Choose an objective",
      );
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("submit", () => {
    it("creates a Google campaign with no objective, then closes and says so", async () => {
      createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
      const user = await openSheet();

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
      const user = await openSheet("meta_ads");

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

    it("tells the precision on 422 and keeps the form open", async () => {
      createMock.mockResolvedValue({
        ok: false,
        error: { code: "BAD_INPUT", message: "Core text", status: 422 },
      });
      const user = await openSheet();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Use at most 2 decimal places for USD."),
      ).toBeVisible();
      expect(screen.queryByText("Core text")).toBeNull();
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(nameInput()).toHaveValue("Spring sale");
    });

    it("asks to reconnect on 409", async () => {
      createMock.mockResolvedValue({
        ok: false,
        error: { code: "BAD_INPUT", message: "Core text", status: 409 },
      });
      const user = await openSheet();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Reconnect this account in Accounts"),
      ).toBeVisible();
      expect(screen.queryByText("Core text")).toBeNull();
    });

    it.each([
      [
        "a Core failure",
        { code: "INTERNAL_SERVER_ERROR", message: "Core text" },
      ],
      [
        "a bad gateway",
        { code: "INTERNAL_SERVER_ERROR", message: "x", status: 502 },
      ],
    ])("shows a generic message for %s", async (_name, error) => {
      createMock.mockResolvedValue({ ok: false, error } as never);
      const user = await openSheet();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Failed to create campaign"),
      ).toBeVisible();
      expect(screen.queryByText("Core text")).toBeNull();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("shows the generic message when the action throws", async () => {
      createMock.mockRejectedValue(new Error("network"));
      const user = await openSheet();

      await fill(user, "Spring sale", "10");
      await user.click(submit());

      expect(
        await screen.findByText("Failed to create campaign"),
      ).toBeVisible();
    });
  });
});
