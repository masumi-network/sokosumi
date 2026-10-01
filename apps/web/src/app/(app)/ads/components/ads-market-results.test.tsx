import { act, render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { listMarketKeywordsMock, listMarketAdsMock } = vi.hoisted(() => ({
  listMarketKeywordsMock: vi.fn(),
  listMarketAdsMock: vi.fn(),
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
  adsService: {
    listMarketKeywords: listMarketKeywordsMock,
    listMarketAds: listMarketAdsMock,
  },
}));

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

vi.mock("./ads-error-state", () => ({
  AdsErrorState: ({
    kind,
    failedTitle,
    unavailableTitle,
  }: {
    kind: string;
    failedTitle: string;
    unavailableTitle: string;
  }) => (
    <div data-testid="error">{`${kind}:${kind === "failed" ? failedTitle : unavailableTitle}`}</div>
  ),
}));
vi.mock("./ads-market-keyword-list", () => ({
  AdsMarketKeywordList: ({ keywords }: { keywords: unknown[] }) => (
    <div data-testid="keywords">{keywords.length}</div>
  ),
}));
vi.mock("./ads-market-ad-grid", () => ({
  AdsMarketAdGrid: ({ ads }: { ads: unknown[] }) => (
    <div data-testid="ads">{ads.length}</div>
  ),
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsMarketResults } from "./ads-market-results";

const NOT_CONFIGURED = new CoreApiRequestError("x", {
  status: 503,
  kind: "integration_not_configured",
});
const FAILED = new CoreApiRequestError("x", { status: 502 });
const fetchedAt = new Date();

async function renderResults() {
  const results = await AdsMarketResults({ projectId: "project-1" });
  // The ads are read with `use`, which suspends until they have loaded.
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {results}
      </NextIntlClientProvider>,
    );
  });
}

describe("AdsMarketResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMarketKeywordsMock.mockResolvedValue({
      keywords: [{ keyword: "a" }],
      fetchedAt,
    });
    listMarketAdsMock.mockResolvedValue({
      ads: [{ creativeId: "c" }],
      fetchedAt,
    });
  });

  it("shows both sections, each under its own heading", async () => {
    await renderResults();

    expect(listMarketKeywordsMock).toHaveBeenCalledWith("project-1");
    expect(listMarketAdsMock).toHaveBeenCalledWith("project-1");
    expect(
      screen.getByRole("heading", { name: "Trending keywords" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Ads in your market" }),
    ).toBeVisible();
    expect(screen.getByTestId("keywords")).toHaveTextContent("1");
    expect(screen.getByTestId("ads")).toHaveTextContent("1");
  });

  it("says once that market data is unavailable, in place of both sections", async () => {
    listMarketKeywordsMock.mockRejectedValue(NOT_CONFIGURED);
    listMarketAdsMock.mockRejectedValue(NOT_CONFIGURED);

    await renderResults();

    expect(screen.getAllByTestId("error")).toHaveLength(1);
    expect(screen.getByTestId("error")).toHaveTextContent(
      "unavailable:Market data isn't available yet",
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("lets keywords fail without hiding the ads", async () => {
    listMarketKeywordsMock.mockRejectedValue(FAILED);

    await renderResults();

    expect(screen.getByTestId("error")).toHaveTextContent(
      "failed:Failed to load keywords",
    );
    expect(screen.getByTestId("ads")).toBeVisible();
  });

  it("lets the ads fail without hiding the keywords", async () => {
    listMarketAdsMock.mockRejectedValue(FAILED);

    await renderResults();

    expect(screen.getByTestId("keywords")).toBeVisible();
    expect(screen.getByText("failed:Failed to load ads")).toBeVisible();
  });

  it("says empty keywords and ads calmly", async () => {
    listMarketKeywordsMock.mockResolvedValue({ keywords: [], fetchedAt });
    listMarketAdsMock.mockResolvedValue({ ads: [], fetchedAt });

    await renderResults();

    expect(
      screen.getByText("No trending keywords found for this market"),
    ).toBeVisible();
    expect(
      screen.getByText("No ads found for these advertisers yet"),
    ).toBeVisible();
  });

  it("lets a failure that is not Core's reach the route's error boundary", async () => {
    listMarketKeywordsMock.mockRejectedValue(new Error("session lost"));

    await expect(renderResults()).rejects.toThrow("session lost");
  });
});
