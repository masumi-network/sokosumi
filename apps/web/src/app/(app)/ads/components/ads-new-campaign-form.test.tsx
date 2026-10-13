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

const {
  pushMock,
  toastErrorMock,
  toastSuccessMock,
  uploadMock,
  sizes,
  pickState,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadMock: vi.fn(),
  /** Natural sizes by file name; the browser reads them from the pixels. */
  sizes: new Map<string, { width: number; height: number }>(),
  /** The Drive file the picker hands back when its button is pressed. */
  pickState: { file: null as null | Record<string, unknown> },
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
  useSession: () => ({ data: { session: { activeOrganizationId: "org-1" } } }),
}));
vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (file: Record<string, unknown>) => void;
  }) =>
    open ? (
      <button
        onClick={() => pickState.file && onSelect(pickState.file)}
        type="button"
      >
        Pick the Drive file
      </button>
    ) : null,
}));
vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: (...args: unknown[]) => uploadMock(...args),
  isDriveFileUploadDuplicate: (error: unknown) =>
    error instanceof Error && error.message === "duplicate",
}));
vi.mock("@/lib/ads/image-size.client", () => {
  const read = (name: string) => {
    const size = sizes.get(name);
    return size ? Promise.resolve(size) : Promise.reject(new Error("unread"));
  };
  return {
    readFileImageSize: (file: File) => read(file.name),
    readImageSize: (url: string) => read(url.split("/").pop() ?? ""),
  };
});

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

const DISPLAY_TARGETING: GoogleTargeting = {
  languageOptions: LANGUAGES.slice(0, 2),
  defaultLocations: [],
  defaultLanguages: [{ id: "1001", name: "German" }],
};

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
  const user = userEvent.setup({ applyAccept: false });
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

const BLOB = "https://store.public.blob.vercel-storage.com/drive/users/u1";

const typeOption = (name: "Search" | "Display") =>
  screen.getByRole("radio", { name });
const imageFiles = () => screen.getByLabelText("Image files");
const logoFiles = () => screen.getByLabelText("Logo files");
const imagesGroup = () => within(screen.getByRole("group", { name: "Images" }));

function pngFile(name: string, type = "image/png", bytes = 1000): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

/** Sizes the browser would read, then what Drive would answer for the upload. */
function knowImage(name: string, width: number, height: number) {
  sizes.set(name, { width, height });
}

const WIDE = "wide.png";
const SQUARE = "square.png";
const LOGO = "logo.png";

async function chooseDisplay(user: User) {
  await user.click(typeOption("Display"));
}

async function uploadImages(user: User, ...files: File[]) {
  await user.upload(imageFiles(), files);
}

async function addMinimumImages(user: User) {
  await uploadImages(user, pngFile(WIDE), pngFile(SQUARE));
  await screen.findByRole("img", { name: SQUARE });
}

/** Everything a Display campaign needs but the images. */
async function fillDisplay(user: User) {
  await user.type(screen.getByLabelText("Name"), "  Spring sale ");
  await user.type(screen.getByLabelText("Daily budget (USD)"), "25.5");
  await user.type(screen.getByLabelText("Final URL"), "https://example.com/x");
  await user.type(screen.getByLabelText("Business name"), " Acme ");
  await user.type(screen.getByLabelText("Headline 1"), "Free returns");
  await user.type(
    screen.getByLabelText("Long headline"),
    "Shoes for every run",
  );
  await user.type(screen.getByLabelText("Description 1"), "Order today");
}

describe("AdsNewCampaignForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sizes.clear();
    pickState.file = null;
    knowImage(WIDE, 1200, 628);
    knowImage(SQUARE, 600, 600);
    knowImage(LOGO, 256, 256);
    uploadMock.mockImplementation(async (file: File) => ({
      pathname: `drive/users/u1/${file.name}`,
      fileUrl: `${BLOB}/${file.name}`,
    }));
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

  describe("Google Display", () => {
    describe("type picker", () => {
      it("starts on Search and offers Search and Display", async () => {
        await renderForm({ targeting: DISPLAY_TARGETING });

        expect(typeOption("Search")).toBeChecked();
        expect(typeOption("Display")).not.toBeChecked();
        expect(screen.getByRole("heading", { name: "Type" })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Keywords" })).toBeVisible();
        expect(screen.queryByLabelText("Business name")).toBeNull();
      });

      it("swaps Keywords and the search ad for the display ad", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });

        await chooseDisplay(user);

        expect(typeOption("Display")).toBeChecked();
        expect(screen.queryByRole("heading", { name: "Keywords" })).toBeNull();
        expect(screen.queryByLabelText("Path 1")).toBeNull();
        expect(screen.getByLabelText("Business name")).toBeVisible();
        expect(screen.getByLabelText("Long headline")).toBeVisible();
        expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(1);
        expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(1);
        expect(screen.getByText("Images")).toBeVisible();
        expect(screen.getByText("Logo")).toBeVisible();
      });

      it("keeps the shared values when the type changes, both ways", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await user.type(screen.getByLabelText("Name"), "Spring sale");
        await user.type(screen.getByLabelText("Daily budget (USD)"), "25");
        await user.type(screen.getByLabelText("Start date"), "2026-11-01");
        await user.type(screen.getByLabelText("End date"), "2026-11-30");
        await user.type(
          screen.getByLabelText("Final URL"),
          "https://example.com/x",
        );
        await user.type(screen.getByLabelText("Headline 1"), "Search headline");

        await chooseDisplay(user);

        expect(screen.getByLabelText("Name")).toHaveValue("Spring sale");
        expect(screen.getByLabelText("Daily budget (USD)")).toHaveValue(25);
        expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01");
        expect(screen.getByLabelText("End date")).toHaveValue("2026-11-30");
        expect(screen.getByLabelText("Final URL")).toHaveValue(
          "https://example.com/x",
        );
        expect(screen.getByText("German")).toBeVisible();
        // The Search ad's own texts stay out of the Display ad.
        expect(screen.getByLabelText("Headline 1")).toHaveValue("");

        await user.type(
          screen.getByLabelText("Headline 1"),
          "Display headline",
        );
        await user.click(typeOption("Search"));

        expect(screen.getByLabelText("Name")).toHaveValue("Spring sale");
        expect(screen.getByLabelText("Final URL")).toHaveValue(
          "https://example.com/x",
        );
        expect(screen.getByLabelText("Headline 1")).toHaveValue(
          "Search headline",
        );
        expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(3);
      });

      it("keeps the chosen type when it is clicked again", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.click(typeOption("Display"));

        expect(typeOption("Display")).toBeChecked();
        expect(screen.getByLabelText("Business name")).toBeVisible();
      });

      it("clears the refusals of the type it leaves", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await user.click(submit());
        expect(await screen.findByText("Enter a name.")).toBeVisible();
        expect(screen.getByText("Add at least one keyword.")).toBeVisible();

        await chooseDisplay(user);

        expect(screen.queryByText("Add at least one keyword.")).toBeNull();
        // Shared Basics refusals stay; only the other type's are cleared.
        expect(screen.getByText("Enter a name.")).toBeVisible();
      });
    });

    describe("the ad", () => {
      it("counts business name, headlines, long headline and descriptions", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        expect(screen.getByLabelText("Business name")).toHaveValue("");
        await user.type(screen.getByLabelText("Business name"), "Acme");
        await user.type(screen.getByLabelText("Headline 1"), "Free returns");
        await user.type(screen.getByLabelText("Long headline"), "Shoes");
        await user.type(screen.getByLabelText("Description 1"), "Order today");

        expect(screen.getByText("4/25")).toBeVisible();
        expect(screen.getByText("12/30")).toBeVisible();
        expect(screen.getByText("5/90")).toBeVisible();
        expect(screen.getByText("11/90")).toBeVisible();
      });

      it("adds headlines and descriptions up to 5", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        for (let count = 1; count < 5; count += 1) {
          await user.click(
            screen.getByRole("button", { name: "Add headline" }),
          );
          await user.click(
            screen.getByRole("button", { name: "Add description" }),
          );
        }

        expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(5);
        expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(5);
        expect(
          screen.queryByRole("button", { name: "Add headline" }),
        ).toBeNull();
        expect(
          screen.queryByRole("button", { name: "Add description" }),
        ).toBeNull();
      });

      it("refuses an empty business name and long headline on submit", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.click(submit());

        expect(
          await screen.findByText("Enter the business name."),
        ).toBeVisible();
        expect(screen.getByText("Enter a long headline.")).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });
    });

    describe("images", () => {
      it("uploads to the Workspace's Drive and shows each with its role", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        const wide = pngFile(WIDE);

        await uploadImages(user, wide, pngFile(SQUARE));

        expect(await screen.findByRole("img", { name: WIDE })).toBeVisible();
        expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
        expect(uploadMock).toHaveBeenCalledWith(wide, {
          scope: "org",
          organizationId: "org-1",
        });
        const tile = (name: string) =>
          within(
            screen.getByRole("img", { name }).closest("li") as HTMLElement,
          );
        expect(tile(WIDE).getByText("Landscape")).toBeVisible();
        expect(tile(SQUARE).getByText("Square")).toBeVisible();
        expect(
          screen.getByText("Landscape 1 · Square 1 · 2 of 6 images"),
        ).toBeVisible();
        expect(screen.queryByText(/Add at least one/)).toBeNull();
      });

      it("names its buttons by their visible text, within the group they belong to", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        for (const group of ["Images", "Logo"]) {
          const buttons = within(screen.getByRole("group", { name: group }));
          expect(buttons.getByRole("button", { name: "Upload" })).toBeVisible();
          expect(
            buttons.getByRole("button", { name: "Choose from Drive" }),
          ).toBeVisible();
        }
      });

      it("announces what it refuses in a region that is there from the start", async () => {
        knowImage("photo.png", 1200, 900);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        const region = () => imagesGroup().getByRole("status");
        expect(region()).toBeEmptyDOMElement();

        await uploadImages(user, pngFile("photo.png"));

        await waitFor(() =>
          expect(region()).toHaveTextContent(/^photo\.png: use a landscape/),
        );
        await uploadImages(user, pngFile(WIDE));
        await screen.findByRole("img", { name: WIDE });
        expect(region()).toBeEmptyDOMElement();
      });

      it("ties the refusal of a submit to the images, which are marked invalid", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await fillDisplay(user);
        await user.upload(imageFiles(), pngFile(SQUARE));
        await screen.findByRole("img", { name: SQUARE });
        const group = () => screen.getByRole("group", { name: "Images" });
        expect(group()).not.toBeInvalid();

        await user.click(submit());

        await screen.findByText("Add at least one landscape image.");
        expect(group()).toBeInvalid();
        expect(group()).toHaveAccessibleDescription(
          /Add at least one landscape image\./,
        );
      });

      it("says what is missing until there is a landscape and a square image", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        expect(
          screen.getByText("Add at least one landscape and one square image."),
        ).toBeVisible();

        await uploadImages(user, pngFile(WIDE));
        await screen.findByRole("img", { name: WIDE });
        expect(
          screen.getByText("Add at least one square image."),
        ).toBeVisible();

        await uploadImages(user, pngFile(SQUARE));
        await screen.findByRole("img", { name: SQUARE });
        expect(screen.queryByText(/Add at least one/)).toBeNull();
      });

      it("tells a picture's role from its size, within 1% of 1.91:1 and 1:1", async () => {
        knowImage("near-wide.png", 1000, 519);
        knowImage("near-square.png", 500, 504);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(
          user,
          pngFile("near-wide.png"),
          pngFile("near-square.png"),
        );

        await screen.findByRole("img", { name: "near-square.png" });
        expect(
          screen.getByText("Landscape 1 · Square 1 · 2 of 6 images"),
        ).toBeVisible();
      });

      it.each([
        ["a 4:3 photo", 1200, 900],
        ["a portrait", 600, 900],
      ])(
        "refuses %s with the ratios it needs, uploading nothing",
        async (_n, width, height) => {
          knowImage("photo.png", width, height);
          const user = await renderForm({ targeting: DISPLAY_TARGETING });
          await chooseDisplay(user);

          await uploadImages(user, pngFile("photo.png"));

          const message = await screen.findByText(
            /^photo\.png: use a landscape/,
          );
          expect(message).toHaveTextContent("1.91:1");
          expect(message).toHaveTextContent("600 × 314");
          expect(message).toHaveTextContent("1:1");
          expect(message).toHaveTextContent("300 × 300");
          expect(uploadMock).not.toHaveBeenCalled();
          expect(screen.queryByRole("img", { name: "photo.png" })).toBeNull();
        },
      );

      it("refuses a picture under the minimum size", async () => {
        knowImage("tiny.png", 400, 209);
        knowImage("tiny-square.png", 200, 200);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(
          user,
          pngFile("tiny.png"),
          pngFile("tiny-square.png"),
        );

        expect(
          await screen.findByText(
            "tiny.png: landscape images need at least 600 × 314 px.",
          ),
        ).toBeVisible();
        expect(
          screen.getByText(
            "tiny-square.png: square images need at least 300 × 300 px.",
          ),
        ).toBeVisible();
        expect(uploadMock).not.toHaveBeenCalled();
      });

      it("refuses a file over 5120 KB or of another type, before reading it", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(
          user,
          pngFile("huge.png", "image/png", 5 * 1024 * 1024 + 1),
          pngFile("photo.webp", "image/webp"),
        );

        expect(
          await screen.findByText("huge.png: use an image of at most 5 MB."),
        ).toBeVisible();
        expect(
          screen.getByText("photo.webp: use a JPEG, PNG or GIF image."),
        ).toBeVisible();
        expect(uploadMock).not.toHaveBeenCalled();
      });

      it("refuses a picture it cannot read", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(user, pngFile("broken.png"));

        expect(
          await screen.findByText("broken.png: failed to read this image."),
        ).toBeVisible();
        expect(uploadMock).not.toHaveBeenCalled();
      });

      it("does not add a picture when the upload fails, and says so", async () => {
        uploadMock.mockRejectedValue(new Error("down"));
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(user, pngFile(WIDE));

        await waitFor(() =>
          expect(toastErrorMock).toHaveBeenCalledWith(
            "Failed to upload the image",
          ),
        );
        expect(screen.queryByRole("img", { name: WIDE })).toBeNull();
      });

      it("points to Drive when a file with that name is already there", async () => {
        uploadMock.mockRejectedValue(new Error("duplicate"));
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(user, pngFile(WIDE));

        await waitFor(() =>
          expect(toastErrorMock).toHaveBeenCalledWith(
            "A file with this name already exists in your Drive. Choose it from Drive instead.",
          ),
        );
      });

      it("chooses a file from Drive, reading its size from the file", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        pickState.file = {
          name: SQUARE,
          size: 5000,
          pathname: `drive/users/u1/${SQUARE}`,
          fileUrl: `${BLOB}/${SQUARE}`,
          uploadedAt: new Date(),
        };

        await user.click(
          imagesGroup().getByRole("button", { name: "Choose from Drive" }),
        );
        await user.click(
          screen.getByRole("button", { name: "Pick the Drive file" }),
        );

        expect(await screen.findByRole("img", { name: SQUARE })).toBeVisible();
        expect(uploadMock).not.toHaveBeenCalled();
        expect(
          screen.getByText("Landscape 0 · Square 1 · 1 of 6 images"),
        ).toBeVisible();
      });

      it("refuses a Drive file of the wrong shape, and one already added", async () => {
        knowImage("photo.png", 1200, 900);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        const pick = async (name: string) => {
          pickState.file = {
            name,
            size: 5000,
            pathname: `drive/users/u1/${name}`,
            fileUrl: `${BLOB}/${name}`,
            uploadedAt: new Date(),
          };
          await user.click(
            imagesGroup().getByRole("button", { name: "Choose from Drive" }),
          );
          await user.click(
            screen.getByRole("button", { name: "Pick the Drive file" }),
          );
        };

        await pick("photo.png");
        expect(
          await screen.findByText(/^photo\.png: use a landscape/),
        ).toBeVisible();

        await pick(WIDE);
        await screen.findByRole("img", { name: WIDE });
        await pick(WIDE);
        expect(
          await screen.findByText("wide.png is already added."),
        ).toBeVisible();
        expect(screen.getAllByRole("img", { name: WIDE })).toHaveLength(1);
      });

      it("stops at 6 landscape and square images", async () => {
        const names = Array.from({ length: 7 }, (_, i) => `square-${i}.png`);
        for (const name of names) knowImage(name, 600, 600);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await uploadImages(user, ...names.map((name) => pngFile(name)));

        expect(
          await screen.findByText("Use at most 6 landscape and square images."),
        ).toBeVisible();
        expect(screen.getAllByRole("img")).toHaveLength(6);
        expect(uploadMock).toHaveBeenCalledTimes(6);
      });

      it("removes a picture", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await addMinimumImages(user);

        await user.click(
          screen.getByRole("button", { name: "Remove wide.png" }),
        );

        expect(screen.queryByRole("img", { name: WIDE })).toBeNull();
        expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
        expect(
          screen.getByText("Add at least one landscape image."),
        ).toBeVisible();
      });

      it("keeps the pictures when the type is switched away and back", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await addMinimumImages(user);

        await user.click(typeOption("Search"));
        await user.click(typeOption("Display"));

        expect(screen.getByRole("img", { name: WIDE })).toBeVisible();
        expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
      });
    });

    describe("logos", () => {
      it("takes a square picture as a logo, apart from the images", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.upload(logoFiles(), pngFile(LOGO));

        expect(await screen.findByRole("img", { name: LOGO })).toBeVisible();
        expect(screen.getByText("1 of 2 logos")).toBeVisible();
        // It is not a marketing image, so the ad still lacks those.
        expect(
          screen.getByText("Landscape 0 · Square 0 · 0 of 6 images"),
        ).toBeVisible();
        expect(
          screen.getByText("Add at least one landscape and one square image."),
        ).toBeVisible();
      });

      it("takes a 128 x 128 logo that a square image would refuse", async () => {
        knowImage("small-logo.png", 128, 128);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.upload(logoFiles(), pngFile("small-logo.png"));

        expect(
          await screen.findByRole("img", { name: "small-logo.png" }),
        ).toBeVisible();
      });

      it("refuses a landscape picture as a logo, and a logo under 128 x 128", async () => {
        knowImage("small.png", 100, 100);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.upload(logoFiles(), [pngFile(WIDE), pngFile("small.png")]);

        expect(
          await screen.findByText("wide.png: logos must be square (1:1)."),
        ).toBeVisible();
        expect(
          screen.getByText("small.png: logos need at least 128 × 128 px."),
        ).toBeVisible();
        expect(uploadMock).not.toHaveBeenCalled();
      });

      it("stops at 2 logos", async () => {
        for (const name of ["a.png", "b.png", "c.png"])
          knowImage(name, 256, 256);
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);

        await user.upload(logoFiles(), [
          pngFile("a.png"),
          pngFile("b.png"),
          pngFile("c.png"),
        ]);

        expect(await screen.findByText("Use at most 2 logos.")).toBeVisible();
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });
    });

    describe("submit", () => {
      const sentSpec = () => createMock.mock.calls[0]?.[0].google;

      it("blocks the submit and says what is missing, without a landscape or square image", async () => {
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await fillDisplay(user);
        await user.upload(imageFiles(), pngFile(SQUARE));
        await screen.findByRole("img", { name: SQUARE });

        await user.click(submit());

        expect(
          await screen.findByText("Add at least one landscape image."),
        ).toBeVisible();
        expect(createMock).not.toHaveBeenCalled();
      });

      it("blocks the submit while an image uploads", async () => {
        let finish: (value: { pathname: string; fileUrl: string }) => void =
          () => undefined;
        uploadMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        expect(submit()).toBeEnabled();

        await uploadImages(user, pngFile(WIDE));

        await waitFor(() => expect(submit()).toBeDisabled());
        expect(screen.getByText("Uploading images…")).toBeVisible();
        // Both places to add pictures wait for it.
        expect(
          imagesGroup().getByRole("button", { name: "Choose from Drive" }),
        ).toBeDisabled();
        expect(
          within(screen.getByRole("group", { name: "Logo" })).getByRole(
            "button",
            { name: "Upload" },
          ),
        ).toBeDisabled();

        finish({
          pathname: `drive/users/u1/${WIDE}`,
          fileUrl: `${BLOB}/${WIDE}`,
        });

        await screen.findByRole("img", { name: WIDE });
        await waitFor(() => expect(submit()).toBeEnabled());
        expect(screen.queryByText("Uploading images…")).toBeNull();
      });

      it("sends the Display spec with the images and their roles", async () => {
        createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await fillDisplay(user);
        await user.type(screen.getByLabelText("Start date"), "2026-11-01");
        await addMinimumImages(user);
        await user.upload(logoFiles(), pngFile(LOGO));
        await screen.findByRole("img", { name: LOGO });

        await user.click(submit());

        await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        const image = (name: string, role: string, size = 1) => ({
          pathname: `drive/users/u1/${name}`,
          fileUrl: `${BLOB}/${name}`,
          name,
          size,
          mimeType: "image/png",
          role,
        });
        expect(createMock).toHaveBeenCalledWith({
          projectId: "project-1",
          accountId: "account-1",
          name: "Spring sale",
          dailyBudget: 25.5,
          google: {
            type: "DISPLAY",
            startDate: "2026-11-01",
            locationIds: [],
            languageIds: ["1001"],
            finalUrl: "https://example.com/x",
            businessName: "Acme",
            headlines: ["Free returns"],
            longHeadline: "Shoes for every run",
            descriptions: ["Order today"],
            images: [
              image(WIDE, "LANDSCAPE", 1000),
              image(SQUARE, "SQUARE", 1000),
              image(LOGO, "LOGO", 1000),
            ],
          },
        });
        expect(sentSpec()).not.toHaveProperty("keywords");
        expect(toastSuccessMock).toHaveBeenCalledWith(
          "Campaign created (paused)",
        );
        expect(pushMock).toHaveBeenCalled();
      });

      it("shows Google's refusal above the form and keeps the images", async () => {
        createMock.mockResolvedValue({
          ok: false,
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: 'Image "wide.png": Image is too small.',
            status: 422,
          },
        });
        const user = await renderForm({ targeting: DISPLAY_TARGETING });
        await chooseDisplay(user);
        await fillDisplay(user);
        await addMinimumImages(user);

        await user.click(submit());

        expect(
          await screen.findByText('Image "wide.png": Image is too small.'),
        ).toBeVisible();
        expect(screen.getByRole("img", { name: WIDE })).toBeVisible();
        expect(screen.getByLabelText("Business name")).toHaveValue(" Acme ");
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

    it("maps 422 to the budget field in our words, never Core's text", async () => {
      createMock.mockResolvedValue(
        refused(422, "dailyBudget has too many decimals"),
      );
      const user = await renderForm({ provider: "meta_ads" });
      await user.type(nameInput(), "Spring sale");
      await user.type(budgetInput(), "10");
      await user.click(screen.getByRole("combobox", { name: "Objective" }));
      await user.click(screen.getByRole("option", { name: "Leads" }));

      await user.click(submit());

      expect(
        await screen.findByText("Use at most 2 decimal places for USD."),
      ).toBeVisible();
      expect(screen.queryByText(/dailyBudget/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
