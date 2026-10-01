import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { getMarketProfileMock, localeMock } = vi.hoisted(() => ({
  getMarketProfileMock: vi.fn(),
  localeMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => localeMock(),
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages,
      namespace: namespace as "App.Ads.market",
    }),
}));

vi.mock("@/lib/services/ads.service", () => ({
  adsService: { getMarketProfile: getMarketProfileMock },
}));

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

vi.mock("./ads-market-profile", () => ({
  AdsMarketProfile: ({
    profile,
    summary,
    countries,
    languages,
  }: {
    profile: unknown;
    summary: string | null;
    countries: { name: string }[];
    languages: { name: string }[];
  }) => (
    <div data-testid="profile">
      {profile ? "summary" : "form"}|{summary}|{countries[0].name}|
      {languages.map(({ name }) => name).join(",")}
    </div>
  ),
}));
vi.mock("./ads-market-results", () => ({
  AdsMarketResults: ({ projectId }: { projectId: string }) => (
    <div data-testid="results">{projectId}</div>
  ),
}));
vi.mock("./ads-error-state", () => ({
  AdsErrorState: ({
    kind,
    failedTitle,
  }: {
    kind: string;
    failedTitle: string;
  }) => <div data-testid="error">{`${kind}:${failedTitle}`}</div>,
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsMarketSection } from "./ads-market-section";

const PROFILE = {
  keywords: ["running shoes", "trail shoes"],
  countryCode: "DE",
  languageCode: "de",
  updatedAt: new Date(),
};

async function renderSection() {
  render(await AdsMarketSection({ projectId: "project-1" }));
}

describe("AdsMarketSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeMock.mockReturnValue("en");
  });

  it("is only the form without a profile, requesting no market data", async () => {
    getMarketProfileMock.mockResolvedValue({ profile: null });

    await renderSection();

    expect(getMarketProfileMock).toHaveBeenCalledWith("project-1");
    expect(screen.getByTestId("profile")).toHaveTextContent(
      /^form\|\|Australia/,
    );
    expect(screen.queryByTestId("results")).toBeNull();
  });

  it("names the summary, countries and languages in the reader's language", async () => {
    getMarketProfileMock.mockResolvedValue({ profile: PROFILE });

    await renderSection();

    const profile = screen.getByTestId("profile");
    expect(profile).toHaveTextContent(
      "summary|running shoes, trail shoes · Germany · German|Australia|",
    );
    expect(profile).toHaveTextContent("French");
  });

  it("uses the user's locale", async () => {
    localeMock.mockReturnValue("de");
    getMarketProfileMock.mockResolvedValue({ profile: PROFILE });

    await renderSection();

    expect(screen.getByTestId("profile")).toHaveTextContent(
      "running shoes, trail shoes · Deutschland · Deutsch",
    );
  });

  it("loads the market's keywords and ads beside a saved profile", async () => {
    getMarketProfileMock.mockResolvedValue({ profile: PROFILE });

    await renderSection();

    expect(screen.getByTestId("results")).toHaveTextContent("project-1");
  });

  it("reports a profile that fails to load, in place of the market", async () => {
    getMarketProfileMock.mockRejectedValue(
      new CoreApiRequestError("x", { status: 502 }),
    );

    await renderSection();

    expect(screen.getByTestId("error")).toHaveTextContent(
      "failed:Failed to load your market",
    );
    expect(screen.queryByTestId("results")).toBeNull();
  });
});
