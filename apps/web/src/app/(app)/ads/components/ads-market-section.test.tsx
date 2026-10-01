import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { getMarketProfileMock } = vi.hoisted(() => ({
  getMarketProfileMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
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
  AdsMarketProfile: ({ profile }: { profile: unknown }) => (
    <div data-testid="profile">{profile ? "summary" : "form"}</div>
  ),
}));
vi.mock("./ads-market-keywords", () => ({
  AdsMarketKeywords: () => <div data-testid="keywords" />,
}));
vi.mock("./ads-market-ads", () => ({
  AdsMarketAds: () => <div data-testid="ads" />,
}));
vi.mock("./ads-market-error", () => ({
  AdsMarketError: ({ kind, section }: { kind: string; section: string }) => (
    <div data-testid="error">{`${section}:${kind}`}</div>
  ),
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsMarketSection } from "./ads-market-section";

const PROFILE = {
  keywords: ["running shoes"],
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
  });

  it("is only the form without a profile, requesting no market data", async () => {
    getMarketProfileMock.mockResolvedValue({ profile: null });

    await renderSection();

    expect(getMarketProfileMock).toHaveBeenCalledWith("project-1");
    expect(screen.getByTestId("profile")).toHaveTextContent("form");
    expect(screen.queryByTestId("keywords")).toBeNull();
    expect(screen.queryByTestId("ads")).toBeNull();
  });

  it("shows the summary and both sections, each under its own heading", async () => {
    getMarketProfileMock.mockResolvedValue({ profile: PROFILE });

    await renderSection();

    expect(screen.getByTestId("profile")).toHaveTextContent("summary");
    expect(
      screen.getByRole("heading", { name: "Trending keywords" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Ads in your market" }),
    ).toBeVisible();
    expect(screen.getByTestId("keywords")).toBeVisible();
    expect(screen.getByTestId("ads")).toBeVisible();
  });

  it("reports a profile that fails to load, in place of the market", async () => {
    getMarketProfileMock.mockRejectedValue(
      new CoreApiRequestError("x", { status: 502 }),
    );

    await renderSection();

    expect(screen.getByTestId("error")).toHaveTextContent("profile:failed");
    expect(screen.queryByTestId("keywords")).toBeNull();
  });
});
