import type { AdMarketProfile } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveAdsMarketProfile } from "@/lib/actions/ads/action";
import deMessages from "../../../../../messages/de.json";
import messages from "../../../../../messages/en.json";
import { AdsMarketProfile } from "./ads-market-profile";

const { toastSuccessMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccessMock(...args) },
}));
vi.mock("@/lib/actions/ads/action", () => ({ saveAdsMarketProfile: vi.fn() }));

const saveMock = vi.mocked(saveAdsMarketProfile);

type SaveResult = Awaited<ReturnType<typeof saveAdsMarketProfile>>;

const SAVED: NonNullable<AdMarketProfile> = {
  keywords: ["running shoes", "trail shoes"],
  countryCode: "DE",
  languageCode: "de",
  updatedAt: new Date("2026-10-01T10:00:00.000Z"),
};

function renderProfile(
  profile: AdMarketProfile = null,
  locale: "en" | "de" = "en",
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? messages : deMessages}
    >
      <AdsMarketProfile profile={profile} projectId="project-1" />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

const keywordsInput = () => screen.getByLabelText("Keywords");
const country = () => screen.getByRole("combobox", { name: "Country" });
const language = () => screen.getByRole("combobox", { name: "Language" });
const save = () => screen.getByRole("button", { name: "Save market" });

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
  option: string,
) {
  await user.click(combobox);
  await user.click(screen.getByRole("option", { name: option }));
}

describe("AdsMarketProfile without a profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is the form, so it is the empty state", () => {
    renderProfile();

    expect(screen.getByText("Set up your market")).toBeVisible();
    expect(keywordsInput()).toBeVisible();
    expect(country()).toHaveTextContent("Choose a country");
    expect(language()).toHaveTextContent("Choose a language");
    expect(screen.queryByRole("button", { name: "Edit market" })).toBeNull();
  });

  it("offers the supported countries and languages by name, in order", async () => {
    const user = renderProfile();

    await user.click(country());
    const countries = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(countries).toHaveLength(17);
    expect(countries.slice(0, 3)).toEqual(["Australia", "Austria", "Belgium"]);
    expect(countries).toContain("United Kingdom");
  });

  it("names them in the reader's language", async () => {
    const user = renderProfile(null, "de");

    await user.click(screen.getByRole("combobox", { name: "Sprache" }));

    expect(screen.getByRole("option", { name: "Französisch" })).toBeVisible();
  });

  it("asks for keywords, a country and a language, saving nothing", async () => {
    const user = renderProfile();

    await user.click(save());

    expect(await screen.findByText("Add at least one keyword.")).toBeVisible();
    expect(screen.getByText("Choose a country.")).toBeVisible();
    expect(screen.getByText("Choose a language.")).toBeVisible();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("saves the profile and says so", async () => {
    saveMock.mockResolvedValue({ ok: true, value: { profile: SAVED } });
    const user = renderProfile();

    await user.type(keywordsInput(), "running shoes,trail shoes,");
    await choose(user, country(), "Germany");
    await choose(user, language(), "German");
    await user.click(save());

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        projectId: "project-1",
        keywords: ["running shoes", "trail shoes"],
        countryCode: "DE",
        languageCode: "de",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Market saved");
  });

  it("keeps a keyword typed but not yet added when Save is pressed", async () => {
    saveMock.mockResolvedValue({ ok: true, value: { profile: SAVED } });
    const user = renderProfile();

    await user.type(keywordsInput(), "sandals");
    await choose(user, country(), "Germany");
    await choose(user, language(), "German");
    await user.click(save());

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: ["sandals"] }),
      ),
    );
  });

  it("tells the user when Core refuses, never repeating Core's text", async () => {
    saveMock.mockResolvedValue({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Core text",
        status: 502,
      },
    });
    const user = renderProfile();

    await user.type(keywordsInput(), "sandals,");
    await choose(user, country(), "Germany");
    await choose(user, language(), "German");
    await user.click(save());

    expect(
      await screen.findByText("Could not save the market. Try again."),
    ).toBeVisible();
    expect(screen.queryByText("Core text")).toBeNull();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("tells the user when the request itself throws", async () => {
    saveMock.mockRejectedValue(new Error("network"));
    const user = renderProfile();

    await user.type(keywordsInput(), "sandals,");
    await choose(user, country(), "Germany");
    await choose(user, language(), "German");
    await user.click(save());

    expect(
      await screen.findByText("Could not save the market. Try again."),
    ).toBeVisible();
  });
});

describe("AdsMarketProfile with a profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is one quiet summary line", () => {
    renderProfile(SAVED);

    expect(
      screen.getByText("running shoes, trail shoes · Germany · German"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Keywords")).toBeNull();
  });

  it("opens the same form, filled in, in a dialog", async () => {
    const user = renderProfile(SAVED);

    await user.click(screen.getByRole("button", { name: "Edit market" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeVisible();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["running shoes", "trail shoes"]);
    expect(country()).toHaveTextContent("Germany");
    expect(language()).toHaveTextContent("German");
  });

  it("saves the changes and closes the dialog", async () => {
    saveMock.mockResolvedValue({ ok: true, value: { profile: SAVED } });
    const user = renderProfile(SAVED);

    await user.click(screen.getByRole("button", { name: "Edit market" }));
    await user.click(
      await screen.findByRole("button", { name: "Remove trail shoes" }),
    );
    await choose(user, country(), "Austria");
    await user.click(save());

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        projectId: "project-1",
        keywords: ["running shoes"],
        countryCode: "AT",
        languageCode: "de",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastSuccessMock).toHaveBeenCalledWith("Market saved");
  });

  it("keeps the dialog open on a failure", async () => {
    saveMock.mockResolvedValue({
      ok: false,
      error: { code: "x", message: "Core text" },
    } as SaveResult);
    const user = renderProfile(SAVED);

    await user.click(screen.getByRole("button", { name: "Edit market" }));
    await user.click(
      await screen.findByRole("button", { name: "Save market" }),
    );

    expect(
      await screen.findByText("Could not save the market. Try again."),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("cancels without saving", async () => {
    const user = renderProfile(SAVED);

    await user.click(screen.getByRole("button", { name: "Edit market" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saveMock).not.toHaveBeenCalled();
  });
});
