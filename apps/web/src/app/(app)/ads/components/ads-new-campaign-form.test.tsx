import type { ProjectAdProvider } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdCampaign,
  listAdMarketKeywords,
  searchAdLocations,
} from "@/lib/actions/ads/action";
import type { GoogleTargeting } from "@/lib/ads/targeting";
import messages from "../../../../../messages/en.json";
import { GoogleCampaignForm, MetaCampaignForm } from "./ads-new-campaign-form";

const { pushMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/actions/ads/action", () => ({
  createAdCampaign: vi.fn(),
  listAdMarketKeywords: vi.fn(),
  searchAdLocations: vi.fn(),
}));
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0 }),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));
vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: () => null,
}));

const createMock = vi.mocked(createAdCampaign);
const listMock = vi.mocked(listAdMarketKeywords);
const searchMock = vi.mocked(searchAdLocations);

type CreateResult = Awaited<ReturnType<typeof createAdCampaign>>;

/** Core's refusal as the action reports it: a code, the HTTP status, a text. */
function refused(status?: number, message = "Core text"): CreateResult {
  return {
    ok: false,
    error: { code: "INTERNAL_SERVER_ERROR", message, status },
  };
}

const LANGUAGES = [
  { id: "1000", name: "English" },
  { id: "1001", name: "German" },
  { id: "1003", name: "Spanish" },
];

const NO_DEFAULTS: GoogleTargeting = {
  languageOptions: LANGUAGES,
  defaultLocations: [],
  defaultLanguages: [],
};

interface RenderOptions {
  currency?: string;
  hasMarketProfile?: boolean;
  provider?: ProjectAdProvider;
  targeting?: GoogleTargeting;
}

async function renderForm({
  currency = "USD",
  hasMarketProfile = false,
  provider = "google_ads",
  targeting = NO_DEFAULTS,
}: RenderOptions = {}) {
  const user = userEvent.setup();
  const props = { accountId: "account-1", currency, projectId: "project-1" };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {provider === "google_ads" ? (
        <GoogleCampaignForm
          {...props}
          hasMarketProfile={hasMarketProfile}
          targeting={targeting}
        />
      ) : (
        <MetaCampaignForm {...props} />
      )}
    </NextIntlClientProvider>,
  );
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

const MUNICH = {
  id: "1003854",
  name: "Munich",
  canonicalName: "Munich,Bavaria,Germany",
  targetType: "City",
  countryCode: "DE",
};
const BERLIN = {
  id: "1003869",
  name: "Berlin",
  canonicalName: "Berlin,Berlin,Germany",
  targetType: "State",
  countryCode: "DE",
};

const locationsPicker = () =>
  screen.getByRole("combobox", { name: "Locations" });
const languagesPicker = () =>
  screen.getByRole("combobox", { name: "Languages" });

/** Types into the open location search and picks a result by name. */
async function pickLocation(user: User, query: string, name: string) {
  await user.click(locationsPicker());
  await user.type(screen.getByPlaceholderText("Search locations"), query);
  await user.click(await screen.findByText(name));
}

/** Opens the languages and toggles one by name. */
async function toggleLanguage(user: User, name: string) {
  await user.click(languagesPicker());
  await user.click(await screen.findByRole("option", { name }));
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
      expect(screen.getByText("All countries")).toBeVisible();
      expect(screen.getByText("All languages")).toBeVisible();
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

    describe("sitelinks and callouts", () => {
      const sitelinksToggle = () =>
        screen.getByRole("button", { name: /^Sitelinks/ });
      const calloutsToggle = () =>
        screen.getByRole("button", { name: /^Callouts/ });
      const sitelink = (number: number) =>
        within(screen.getByRole("group", { name: `Sitelink ${number}` }));

      async function addSitelink(
        user: User,
        number: number,
        values: Partial<Record<string, string>>,
      ) {
        await user.click(screen.getByRole("button", { name: "Add sitelink" }));
        const row = sitelink(number);
        for (const [label, text] of Object.entries(values)) {
          await user.type(row.getByLabelText(label), text ?? "");
        }
      }

      it("starts closed, with nothing to fill in and no count", async () => {
        const user = await renderForm();

        expect(sitelinksToggle()).toHaveAccessibleName("Sitelinks (optional)");
        expect(calloutsToggle()).toHaveAccessibleName("Callouts (optional)");
        expect(sitelinksToggle()).toHaveAttribute("aria-expanded", "false");
        expect(
          screen.queryByRole("button", { name: "Add sitelink" }),
        ).toBeNull();

        await user.click(sitelinksToggle());
        expect(sitelinksToggle()).toHaveAttribute("aria-expanded", "true");
        expect(
          screen.getByRole("button", { name: "Add sitelink" }),
        ).toBeVisible();
        expect(screen.queryByRole("group", { name: /^Sitelink/ })).toBeNull();
      });

      it("adds sitelinks up to 8, counts their characters and removes one", async () => {
        const user = await renderForm();
        await user.click(sitelinksToggle());

        await addSitelink(user, 1, {
          "Link text": "Shoes",
          "Description line 1": "Free returns",
        });
        expect(sitelink(1).getByText("5/25")).toBeVisible();
        expect(sitelink(1).getByText("12/35")).toBeVisible();
        expect(sitelinksToggle()).toHaveAccessibleName(
          "Sitelinks (optional) 1 sitelink",
        );

        for (let number = 2; number <= 8; number += 1) {
          await user.click(
            screen.getByRole("button", { name: "Add sitelink" }),
          );
        }
        expect(
          screen.getAllByRole("group", { name: /^Sitelink/ }),
        ).toHaveLength(8);
        expect(
          screen.queryByRole("button", { name: "Add sitelink" }),
        ).toBeNull();

        await user.click(
          screen.getByRole("button", { name: "Remove sitelink 1" }),
        );
        expect(
          screen.getAllByRole("group", { name: /^Sitelink/ }),
        ).toHaveLength(7);
        expect(sitelink(1).getByLabelText("Link text")).toHaveValue("");
        expect(
          screen.getByRole("button", { name: "Add sitelink" }),
        ).toBeVisible();
      });

      it("focuses the add button after the last sitelink is removed", async () => {
        const user = await renderForm();
        await user.click(sitelinksToggle());
        await user.click(screen.getByRole("button", { name: "Add sitelink" }));

        await user.click(
          screen.getByRole("button", { name: "Remove sitelink 1" }),
        );

        expect(
          screen.getByRole("button", { name: "Add sitelink" }),
        ).toHaveFocus();
      });

      it("adds callouts up to 10, counts their characters and removes one", async () => {
        const user = await renderForm();
        await user.click(calloutsToggle());
        expect(screen.queryByLabelText(/^Callout \d+$/)).toBeNull();

        await user.click(screen.getByRole("button", { name: "Add callout" }));
        await user.type(screen.getByLabelText("Callout 1"), "Free shipping");
        expect(screen.getByText("13/25")).toBeVisible();
        expect(calloutsToggle()).toHaveAccessibleName(
          "Callouts (optional) 1 callout",
        );

        for (let count = 1; count < 10; count += 1) {
          await user.click(screen.getByRole("button", { name: "Add callout" }));
        }
        expect(screen.getAllByLabelText(/^Callout \d+$/)).toHaveLength(10);
        expect(
          screen.queryByRole("button", { name: "Add callout" }),
        ).toBeNull();

        await user.click(
          screen.getByRole("button", { name: "Remove callout 1" }),
        );
        expect(screen.getAllByLabelText(/^Callout \d+$/)).toHaveLength(9);
      });

      it("sends the filled sitelinks and callouts, trimmed, and skips empty rows", async () => {
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(sitelinksToggle());
        await addSitelink(user, 1, {
          "Link text": " Shoes ",
          URL: "https://example.com/shoes",
          "Description line 1": "Free returns",
          "Description line 2": "Shipped in a day",
        });
        await addSitelink(user, 2, {
          "Link text": "Sale",
          URL: "https://example.com/sale",
        });
        await user.click(screen.getByRole("button", { name: "Add sitelink" }));
        await user.click(calloutsToggle());
        await user.click(screen.getByRole("button", { name: "Add callout" }));
        await user.type(screen.getByLabelText("Callout 1"), " Free shipping ");
        await user.click(screen.getByRole("button", { name: "Add callout" }));

        await user.click(submit());

        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(createMock.mock.calls[0]?.[0].google).toMatchObject({
          sitelinks: [
            {
              text: "Shoes",
              finalUrl: "https://example.com/shoes",
              description1: "Free returns",
              description2: "Shipped in a day",
            },
            { text: "Sale", finalUrl: "https://example.com/sale" },
          ],
          callouts: ["Free shipping"],
        });
      });

      it("sends neither when none were added or all rows are empty", async () => {
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(sitelinksToggle());
        await user.click(screen.getByRole("button", { name: "Add sitelink" }));

        await user.click(submit());

        await waitFor(() => expect(createMock).toHaveBeenCalled());
        const google = createMock.mock.calls[0]?.[0].google;
        expect(google).not.toHaveProperty("sitelinks");
        expect(google).not.toHaveProperty("callouts");
      });

      it("refuses a sitelink without text or URL, calling nothing", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(sitelinksToggle());
        await addSitelink(user, 1, { "Description line 1": "x" });

        await user.click(submit());

        expect(
          await screen.findByText(
            "Enter the link text or remove this sitelink.",
          ),
        ).toBeVisible();
        expect(
          sitelink(1).getByText(
            "Enter a full address starting with http:// or https://.",
          ),
        ).toBeVisible();
        expect(
          sitelink(1).getByText("Add both description lines or neither."),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("refuses a duplicate sitelink text and a long description", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(sitelinksToggle());
        const url = { URL: "https://example.com/a" };
        await addSitelink(user, 1, { "Link text": "Shoes", ...url });
        await addSitelink(user, 2, {
          "Link text": "SHOES",
          "Description line 1": "x".repeat(36),
          "Description line 2": "ok",
          ...url,
        });

        await user.click(submit());

        expect(
          await screen.findByText("Each sitelink must be different."),
        ).toBeVisible();
        expect(sitelink(2).getByText("36/35")).toBeVisible();
        expect(
          sitelink(2).getByText("Use at most 35 characters."),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("refuses a duplicate and a long callout", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(calloutsToggle());
        for (const text of ["Free shipping", "free shipping", "x".repeat(26)]) {
          await user.click(screen.getByRole("button", { name: "Add callout" }));
          await user.type(
            screen.getAllByLabelText(/^Callout \d+$/).at(-1)!,
            text,
          );
        }

        await user.click(submit());

        expect(
          await screen.findByText("Each callout must be different."),
        ).toBeVisible();
        expect(screen.getByText("Use at most 25 characters.")).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("opens a closed section that holds a refusal", async () => {
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(sitelinksToggle());
        await addSitelink(user, 1, { "Link text": "Shoes" });
        await user.click(sitelinksToggle());
        expect(sitelinksToggle()).toHaveAttribute("aria-expanded", "false");

        await user.click(submit());

        await waitFor(() =>
          expect(sitelinksToggle()).toHaveAttribute("aria-expanded", "true"),
        );
        expect(
          sitelink(1).getByText(
            "Enter a full address starting with http:// or https://.",
          ),
        ).toBeVisible();
      });
    });

    describe("Add from Market", () => {
      it("appends the keywords not there yet as broad lines", async () => {
        listMock.mockResolvedValue({
          ok: true,
          value: ["Running Shoes", "trail shoes", "new one"],
        });
        const user = await renderForm({ hasMarketProfile: true });
        await pasteKeywords(user, '"running shoes"');

        await user.click(
          screen.getByRole("button", { name: "Add from Market" }),
        );

        await waitFor(() =>
          expect(keywordsInput()).toHaveValue(
            '"running shoes"\ntrail shoes\nnew one\n',
          ),
        );
        expect(listMock).toHaveBeenCalledWith({ projectId: "project-1" });
        expect(screen.getByText("3 keywords")).toBeVisible();
      });

      it("stops at 50 keywords", async () => {
        listMock.mockResolvedValue({
          ok: true,
          value: Array.from({ length: 60 }, (_, i) => `market ${i}`),
        });
        const user = await renderForm({ hasMarketProfile: true });

        await user.click(
          screen.getByRole("button", { name: "Add from Market" }),
        );

        expect(await screen.findByText("50 keywords")).toBeVisible();
      });

      it("loads nothing until clicked", async () => {
        await renderForm({ hasMarketProfile: true });

        expect(
          screen.getByRole("button", { name: "Add from Market" }),
        ).toBeVisible();
        expect(listMock).not.toHaveBeenCalled();
      });

      it("leaves the textarea alone when the lookup fails", async () => {
        listMock.mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_SERVER_ERROR", message: "down" },
        });
        const user = await renderForm({ hasMarketProfile: true });
        await pasteKeywords(user, "mine");

        await user.click(
          screen.getByRole("button", { name: "Add from Market" }),
        );

        await waitFor(() =>
          expect(toastErrorMock).toHaveBeenCalledWith(
            "Failed to load Market keywords",
          ),
        );
        expect(keywordsInput()).toHaveValue("mine");
      });

      it("is hidden when the project has no Market profile", async () => {
        await renderForm({ hasMarketProfile: false });

        expect(
          screen.queryByRole("button", { name: "Add from Market" }),
        ).toBeNull();
      });
    });

    describe("targeting", () => {
      const sentSpec = () => createMock.mock.calls[0]?.[0].google;

      it("sends the ids of a searched location and a chosen language", async () => {
        searchMock.mockResolvedValue({ ok: true, value: [MUNICH, BERLIN] });
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);

        await pickLocation(user, " Mun ", "Munich");
        await toggleLanguage(user, "German");

        expect(searchMock).toHaveBeenCalledWith({
          projectId: "project-1",
          accountId: "account-1",
          q: "Mun",
        });
        const chips = screen.getAllByRole("listitem");
        expect(chips.map((chip) => chip.textContent)).toEqual([
          "Munich",
          "German",
        ]);
        expect(screen.queryByText("All countries")).toBeNull();
        expect(screen.queryByText("All languages")).toBeNull();

        await user.click(submit());

        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(sentSpec()).toMatchObject({
          locationIds: ["1003854"],
          languageIds: ["1001"],
        });
      });

      it("shows each result's full name and type", async () => {
        searchMock.mockResolvedValue({ ok: true, value: [MUNICH] });
        const user = await renderForm();

        await user.click(locationsPicker());
        await user.type(screen.getByPlaceholderText("Search locations"), "mun");

        expect(
          await screen.findByText("Munich,Bavaria,Germany · City"),
        ).toBeVisible();
      });

      it("does not offer a location that is already chosen", async () => {
        searchMock.mockResolvedValue({ ok: true, value: [MUNICH, BERLIN] });
        const user = await renderForm();
        await pickLocation(user, "ger", "Munich");

        await user.click(locationsPicker());
        await user.type(screen.getByPlaceholderText("Search locations"), "ger");

        expect(await screen.findByText("Berlin")).toBeVisible();
        expect(screen.getAllByText("Munich")).toHaveLength(1);
      });

      it("removes a chip and goes back to all countries and languages", async () => {
        searchMock.mockResolvedValue({ ok: true, value: [MUNICH] });
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);
        await pickLocation(user, "mun", "Munich");
        await toggleLanguage(user, "German");

        await user.click(
          screen.getByRole("button", {
            name: "Remove Munich, Bavaria, Germany",
          }),
        );
        await user.click(screen.getByRole("button", { name: "Remove German" }));

        expect(screen.getByText("All countries")).toBeVisible();
        expect(screen.getByText("All languages")).toBeVisible();
        await user.click(submit());
        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(sentSpec()).toMatchObject({ locationIds: [], languageIds: [] });
      });

      it("picks several languages and unpicks one in the list", async () => {
        const user = await renderForm();

        await toggleLanguage(user, "German");
        await user.click(screen.getByRole("option", { name: "Spanish" }));
        await user.click(screen.getByRole("option", { name: "German" }));

        expect(
          screen.getAllByRole("listitem").map((chip) => chip.textContent),
        ).toEqual(["Spanish"]);
      });

      it("filters the languages by what is typed", async () => {
        const user = await renderForm();
        await user.click(languagesPicker());

        await user.type(
          screen.getByPlaceholderText("Search languages"),
          "span",
        );

        expect(screen.getByRole("option", { name: "Spanish" })).toBeVisible();
        expect(screen.queryByRole("option", { name: "German" })).toBeNull();
      });

      it("stops at 25 locations", async () => {
        const locations = Array.from({ length: 25 }, (_, i) => ({
          id: `${i + 1}`,
          name: `Place ${i + 1}`,
        }));
        await renderForm({
          targeting: { ...NO_DEFAULTS, defaultLocations: locations },
        });

        expect(locationsPicker()).toBeDisabled();
        expect(screen.getByText("Location limit reached (25).")).toBeVisible();
        expect(screen.getAllByRole("listitem")).toHaveLength(25);
      });

      it("moves focus to the location picker when removing a chip at the limit", async () => {
        const locations = Array.from({ length: 25 }, (_, i) => ({
          id: `${i + 1}`,
          name: `Place ${i + 1}`,
        }));
        const user = await renderForm({
          targeting: { ...NO_DEFAULTS, defaultLocations: locations },
        });
        expect(locationsPicker()).toBeDisabled();

        await user.click(
          screen.getByRole("button", { name: "Remove Place 3" }),
        );

        expect(locationsPicker()).toBeEnabled();
        expect(locationsPicker()).toHaveFocus();
      });

      it("moves focus to the languages picker when removing a language", async () => {
        const user = await renderForm();
        await toggleLanguage(user, "German");
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Remove German" }));

        expect(languagesPicker()).toHaveFocus();
      });

      it("describes each picker by its help text", async () => {
        await renderForm();

        expect(locationsPicker()).toHaveAccessibleDescription(
          "Where your ads can show. Up to 25.",
        );
        expect(languagesPicker()).toHaveAccessibleDescription(
          "Show ads to people who use these languages.",
        );
      });

      it("describes the location picker by the limit once it is reached", async () => {
        const locations = Array.from({ length: 25 }, (_, i) => ({
          id: `${i + 1}`,
          name: `Place ${i + 1}`,
        }));
        await renderForm({
          targeting: { ...NO_DEFAULTS, defaultLocations: locations },
        });

        expect(locationsPicker()).toHaveAccessibleDescription(
          "Location limit reached (25).",
        );
      });

      it("labels a chip's remove button with the location's full name", async () => {
        await renderForm({
          targeting: {
            ...NO_DEFAULTS,
            defaultLocations: [
              {
                id: "1026339",
                name: "Paris",
                detail: "Paris, Texas, United States",
              },
            ],
          },
        });

        expect(
          screen.getByRole("button", {
            name: "Remove Paris, Texas, United States",
          }),
        ).toBeVisible();
      });

      it("starts from the Market profile's location and language, which can be removed", async () => {
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm({
          hasMarketProfile: true,
          targeting: {
            ...NO_DEFAULTS,
            defaultLocations: [
              { id: "2276", name: "Germany", detail: "Germany" },
            ],
            defaultLanguages: [{ id: "1001", name: "German" }],
          },
        });
        await fillGoogle(user);

        expect(
          screen.getAllByRole("listitem").map((chip) => chip.textContent),
        ).toEqual(["Germany", "German"]);
        expect(searchMock).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Remove German" }));
        await user.click(submit());

        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(sentSpec()).toMatchObject({
          locationIds: ["2276"],
          languageIds: [],
        });
      });

      it("says so in the picker when the search fails, and the form still submits", async () => {
        searchMock.mockResolvedValue({
          ok: false,
          error: { code: "INTERNAL_SERVER_ERROR", message: "down" },
        });
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm();
        await fillGoogle(user);

        await user.click(locationsPicker());
        await user.type(screen.getByPlaceholderText("Search locations"), "mun");

        // The popover animates in; wait until the message is shown.
        await waitFor(() =>
          expect(screen.getByText("Failed to search locations.")).toBeVisible(),
        );
        await user.keyboard("{Escape}");
        await user.click(submit());
        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(sentSpec()).toMatchObject({ locationIds: [], languageIds: [] });
      });

      it("explains it when the languages could not be loaded", async () => {
        await renderForm({
          targeting: { ...NO_DEFAULTS, languageOptions: null },
        });

        expect(
          screen.getByText(
            "Failed to load languages. The campaign will target all languages.",
          ),
        ).toBeVisible();
        expect(
          screen.queryByRole("combobox", { name: "Languages" }),
        ).toBeNull();
        expect(screen.getByText("All languages")).toBeVisible();
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
        expect(alert).toHaveTextContent("Failed to create campaign");
        expect(alert).toHaveTextContent("Destination not working.");
        expect(alert).toHaveFocus();
        expect(nameInput()).toHaveValue("  Spring sale ");
        expect(keywordsInput()).toHaveValue(
          'running shoes\n"trail shoes"\n[buy shoes]',
        );
        expect(pushMock).not.toHaveBeenCalled();
        expect(submit()).not.toHaveAttribute("aria-busy");
      });

      it("focuses the alert once, not again while the reader edits", async () => {
        createMock.mockResolvedValue(refused(422, "Destination not working."));
        const user = await renderForm();
        await fillGoogle(user);
        await user.click(submit());
        expect(await screen.findByRole("alert")).toHaveFocus();

        await user.click(nameInput());
        await user.type(nameInput(), "!");

        expect(nameInput()).toHaveFocus();
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
