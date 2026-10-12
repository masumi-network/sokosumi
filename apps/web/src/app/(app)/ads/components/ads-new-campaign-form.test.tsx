import type { ProjectAdProvider } from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdCampaign } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsNewCampaignForm } from "./ads-new-campaign-form";

const { pushMock, toastSuccessMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccessMock(...args) },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/actions/ads/action", () => ({ createAdCampaign: vi.fn() }));

const createMock = vi.mocked(createAdCampaign);

type CreateResult = Awaited<ReturnType<typeof createAdCampaign>>;

/** Core's refusal as the action reports it: a code, the HTTP status, a text. */
function refused(status?: number, message = "Core text"): CreateResult {
  return {
    ok: false,
    error: { code: "INTERNAL_SERVER_ERROR", message, status },
  };
}

interface RenderOptions {
  currency?: string;
  marketKeywords?: string[] | null;
  provider?: ProjectAdProvider;
}

/** Rendered inside `act`, so the Market keywords promise has settled. */
async function renderForm({
  currency = "USD",
  marketKeywords = null,
  provider = "google_ads",
}: RenderOptions = {}) {
  const user = userEvent.setup();
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AdsNewCampaignForm
          accountId="account-1"
          currency={currency}
          marketKeywords={
            marketKeywords === null ? null : Promise.resolve(marketKeywords)
          }
          projectId="project-1"
          provider={provider}
        />
      </NextIntlClientProvider>,
    );
  });
  return user;
}

type User = ReturnType<typeof userEvent.setup>;

const nameInput = () => screen.getByLabelText("Name");
const budgetInput = (currency = "USD") =>
  screen.getByLabelText(`Daily budget (${currency})`);
const keywordsInput = () => screen.getByRole("textbox", { name: "Keywords" });
const submit = () => screen.getByRole("button", { name: "Create campaign" });

async function pasteKeywords(user: User, text: string) {
  await user.click(keywordsInput());
  await user.paste(text);
}

/** Everything a Google campaign needs, with Core's minimum ad. */
async function fillGoogle(user: User) {
  await user.type(nameInput(), "  Spring sale ");
  await user.type(budgetInput(), "25.5");
  await pasteKeywords(user, 'running shoes\n"trail shoes"\n[buy shoes]');
  await user.type(screen.getByLabelText("Final URL"), "https://example.com/x");
  for (const [index, text] of ["One", "Two", "Three"].entries()) {
    await user.type(screen.getByLabelText(`Headline ${index + 1}`), text);
  }
  for (const [index, text] of ["First text", "Second text"].entries()) {
    await user.type(screen.getByLabelText(`Description ${index + 1}`), text);
  }
}

describe("AdsNewCampaignForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Google", () => {
    it("shows Basics, Targeting, Keywords and Ad, with the minimum ad", async () => {
      await renderForm();

      for (const heading of ["Basics", "Targeting", "Keywords", "Ad"]) {
        expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      }
      expect(screen.getByText("All countries · All languages")).toBeVisible();
      expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(3);
      expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(2);
      expect(screen.getByLabelText("Start date")).toBeVisible();
      expect(screen.getByLabelText("End date")).toBeVisible();
      expect(screen.queryByLabelText("Objective")).toBeNull();
    });

    it("steps the budget by the currency's unit", async () => {
      await renderForm({ currency: "JPY" });

      expect(budgetInput("JPY")).toHaveAttribute("step", "1");
    });

    it("counts keywords live, one per line", async () => {
      const user = await renderForm();
      expect(screen.getByText("0 keywords")).toBeVisible();

      await pasteKeywords(user, 'one\n\n"two"\n[three]\n');
      expect(screen.getByText("3 keywords")).toBeVisible();

      await user.clear(keywordsInput());
      await pasteKeywords(user, "only");
      expect(screen.getByText("1 keyword")).toBeVisible();
    });

    it("counts the characters of each headline and description", async () => {
      const user = await renderForm();

      await user.type(screen.getByLabelText("Headline 1"), "Free returns");
      await user.type(screen.getByLabelText("Description 2"), "Order today");

      expect(screen.getByText("12/30")).toBeVisible();
      expect(screen.getByText("11/90")).toBeVisible();
    });

    it("previews the domain and display paths", async () => {
      const user = await renderForm();
      expect(screen.getByText("Shown as example.com")).toBeVisible();

      await user.type(
        screen.getByLabelText("Final URL"),
        "https://www.shop.example.com/x",
      );
      await user.type(screen.getByLabelText("Path 1"), "shoes");
      await user.type(screen.getByLabelText("Path 2"), "sale");

      expect(
        screen.getByText("Shown as shop.example.com/shoes/sale"),
      ).toBeVisible();
    });

    describe("headlines and descriptions", () => {
      it("adds headlines up to 15, then stops offering more", async () => {
        const user = await renderForm();

        for (let count = 3; count < 15; count += 1) {
          await user.click(
            screen.getByRole("button", { name: "Add headline" }),
          );
        }

        expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(15);
        expect(
          screen.queryByRole("button", { name: "Add headline" }),
        ).toBeNull();
      });

      it("adds descriptions up to 4", async () => {
        const user = await renderForm();

        await user.click(
          screen.getByRole("button", { name: "Add description" }),
        );
        await user.click(
          screen.getByRole("button", { name: "Add description" }),
        );

        expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(4);
        expect(
          screen.queryByRole("button", { name: "Add description" }),
        ).toBeNull();
      });

      it("only lets headlines beyond the third be removed", async () => {
        const user = await renderForm();
        expect(
          screen.queryByRole("button", { name: /^Remove headline/ }),
        ).toBeNull();

        await user.click(screen.getByRole("button", { name: "Add headline" }));
        await user.type(screen.getByLabelText("Headline 4"), "Fourth");
        await user.click(
          screen.getByRole("button", { name: "Remove headline 4" }),
        );

        expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(3);
        expect(screen.queryByDisplayValue("Fourth")).toBeNull();
      });

      it("keeps the other texts when one in the middle is removed", async () => {
        const user = await renderForm();
        await user.click(screen.getByRole("button", { name: "Add headline" }));
        await user.type(screen.getByLabelText("Headline 1"), "Alpha");
        await user.type(screen.getByLabelText("Headline 2"), "Beta");
        await user.type(screen.getByLabelText("Headline 4"), "Delta");

        await user.click(
          screen.getByRole("button", { name: "Remove headline 2" }),
        );

        expect(screen.getByLabelText("Headline 1")).toHaveValue("Alpha");
        expect(screen.getByLabelText("Headline 2")).toHaveValue("");
        expect(screen.getByLabelText("Headline 3")).toHaveValue("Delta");
      });
    });

    describe("Add from Market", () => {
      it("appends the keywords not there yet as broad lines", async () => {
        const user = await renderForm({
          marketKeywords: ["Running Shoes", "trail shoes", "new one"],
        });
        await pasteKeywords(user, '"running shoes"');

        await user.click(
          await screen.findByRole("button", { name: "Add from Market" }),
        );

        expect(keywordsInput()).toHaveValue(
          '"running shoes"\ntrail shoes\nnew one\n',
        );
        expect(screen.getByText("3 keywords")).toBeVisible();
      });

      it("stops at 50 keywords", async () => {
        const user = await renderForm({
          marketKeywords: Array.from({ length: 60 }, (_, i) => `market ${i}`),
        });

        await user.click(
          await screen.findByRole("button", { name: "Add from Market" }),
        );

        expect(screen.getByText("50 keywords")).toBeVisible();
      });

      it.each([
        ["has no Market keywords", []],
        ["is not given any", null],
      ])("is hidden when the project %s", async (_name, marketKeywords) => {
        await renderForm({ marketKeywords });

        // The button would resolve after the promise; give it the chance.
        await waitFor(() => {
          expect(
            screen.queryByRole("button", { name: "Add from Market" }),
          ).toBeNull();
        });
      });
    });

    describe("validation", () => {
      it("asks for everything that is missing, calling nothing", async () => {
        const user = await renderForm();

        await user.click(submit());

        expect(await screen.findByText("Enter a name.")).toBeVisible();
        expect(
          screen.getByText("Enter a daily budget greater than 0."),
        ).toBeVisible();
        expect(screen.getByText("Add at least one keyword.")).toBeVisible();
        expect(
          screen.getByText(
            "Enter a full address starting with http:// or https://.",
          ),
        ).toBeVisible();
        expect(
          screen.getAllByText("Enter a headline or remove this one."),
        ).toHaveLength(3);
        expect(
          screen.getAllByText("Enter a description or remove this one."),
        ).toHaveLength(2);
        expect(nameInput()).toHaveAttribute("aria-invalid", "true");
        expect(keywordsInput()).toHaveAttribute("aria-invalid", "true");
        expect(createMock).not.toHaveBeenCalled();
      });

      it("names the first invalid keyword line", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.clear(keywordsInput());
        await pasteKeywords(user, 'fine\n\n"unclosed');

        await user.click(submit());

        expect(
          await screen.findByText("Line 3: check the quotes and brackets."),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("refuses a duplicate headline and one over 30 characters", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.clear(screen.getByLabelText("Headline 2"));
        await user.type(screen.getByLabelText("Headline 2"), "ONE");
        await user.clear(screen.getByLabelText("Headline 3"));
        await user.type(screen.getByLabelText("Headline 3"), "x".repeat(31));

        await user.click(submit());

        expect(
          await screen.findByText("Each headline must be different."),
        ).toBeVisible();
        expect(screen.getByText("Use at most 30 characters.")).toBeVisible();
        expect(screen.getByText("31/30")).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("refuses an end date before the start date", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.type(screen.getByLabelText("Start date"), "2026-11-02");
        await user.type(screen.getByLabelText("End date"), "2026-11-01");

        await user.click(submit());

        expect(
          await screen.findByText(
            "The end date can't be before the start date.",
          ),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("asks for path 1 before path 2", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.type(screen.getByLabelText("Path 2"), "sale");

        await user.click(submit());

        expect(await screen.findByText("Fill in path 1 first.")).toBeVisible();
      });

      it("rejects more decimals than the currency allows", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.clear(budgetInput());
        await user.type(budgetInput(), "10.005");

        await user.click(submit());

        expect(
          await screen.findByText("Use at most 2 decimal places for USD."),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });
    });

    describe("submit", () => {
      it("sends the Search spec with no objective, then says so and goes back", async () => {
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);
        await user.type(screen.getByLabelText("Start date"), "2026-11-01");
        await user.type(screen.getByLabelText("Path 1"), "shoes");

        await user.click(submit());

        await waitFor(() =>
          expect(toastSuccessMock).toHaveBeenCalledWith(
            "Campaign created (paused)",
          ),
        );
        expect(createMock).toHaveBeenCalledWith({
          projectId: "project-1",
          accountId: "account-1",
          name: "Spring sale",
          dailyBudget: 25.5,
          google: {
            type: "SEARCH",
            startDate: "2026-11-01",
            locationIds: [],
            languageIds: [],
            finalUrl: "https://example.com/x",
            keywords: [
              { text: "running shoes", matchType: "BROAD" },
              { text: "trail shoes", matchType: "PHRASE" },
              { text: "buy shoes", matchType: "EXACT" },
            ],
            headlines: ["One", "Two", "Three"],
            descriptions: ["First text", "Second text"],
            path1: "shoes",
          },
        });
        expect(pushMock).toHaveBeenCalledWith(
          "/ads?projectId=project-1&tab=campaigns&account=account-1",
        );
      });

      it("keeps the button busy while the request runs", async () => {
        let resolve: (result: CreateResult) => void = () => undefined;
        createMock.mockReturnValue(
          new Promise<CreateResult>((done) => {
            resolve = done;
          }),
        );
        const user = await renderForm();
        await fillGoogle(user);

        await user.click(submit());

        await waitFor(() =>
          expect(submit()).toHaveAttribute("aria-busy", "true"),
        );
        resolve({ ok: true, value: { id: "42" } });
        await waitFor(() => expect(pushMock).toHaveBeenCalled());
        expect(submit()).toHaveAttribute("aria-busy", "true");
      });

      it("shows Google's message above the form on 422 and keeps the input", async () => {
        createMock.mockResolvedValue(refused(422, "Destination not working."));
        const user = await renderForm();
        await fillGoogle(user);

        await user.click(submit());

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("The campaign wasn't created");
        expect(alert).toHaveTextContent("Destination not working.");
        expect(alert).toHaveFocus();
        expect(nameInput()).toHaveValue("  Spring sale ");
        expect(keywordsInput()).toHaveValue(
          'running shoes\n"trail shoes"\n[buy shoes]',
        );
        expect(pushMock).not.toHaveBeenCalled();
        expect(submit()).not.toHaveAttribute("aria-busy");
      });

      it("asks to reconnect on 409, with a link to Accounts", async () => {
        createMock.mockResolvedValue(refused(409));
        const user = await renderForm();
        await fillGoogle(user);

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
          const user = await renderForm();
          await fillGoogle(user);

          await user.click(submit());

          expect(await screen.findByRole("alert")).toHaveTextContent(
            "Failed to create campaign",
          );
          expect(screen.queryByText("Core text")).toBeNull();
          expect(toastSuccessMock).not.toHaveBeenCalled();
        },
      );

      it("shows the generic message when the action throws", async () => {
        createMock.mockRejectedValue(new Error("network"));
        const user = await renderForm();
        await fillGoogle(user);

        await user.click(submit());

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Failed to create campaign",
        );
      });
    });
  });

  describe("Meta", () => {
    it("has an objective and none of the Search sections", async () => {
      await renderForm({ provider: "meta_ads" });

      expect(screen.getByRole("combobox", { name: "Objective" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Keywords" })).toBeNull();
      expect(screen.queryByLabelText("Final URL")).toBeNull();
      expect(screen.queryByLabelText("Start date")).toBeNull();
    });

    it("requires an objective", async () => {
      const user = await renderForm({ provider: "meta_ads" });
      await user.type(nameInput(), "Spring sale");
      await user.type(budgetInput(), "10");

      await user.click(submit());

      expect(await screen.findByText("Choose an objective.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("sends the chosen objective and no Google spec", async () => {
      createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
      const user = await renderForm({ provider: "meta_ads" });
      await user.type(nameInput(), "Spring sale");
      await user.type(budgetInput(), "10");
      await user.click(screen.getByRole("combobox", { name: "Objective" }));
      await user.click(screen.getByRole("option", { name: "Leads" }));

      await user.click(submit());

      await waitFor(() =>
        expect(createMock).toHaveBeenCalledWith({
          projectId: "project-1",
          accountId: "account-1",
          name: "Spring sale",
          dailyBudget: 10,
          objective: "OUTCOME_LEADS",
        }),
      );
      expect(createMock.mock.calls[0]?.[0]).not.toHaveProperty("google");
    });
  });
});
