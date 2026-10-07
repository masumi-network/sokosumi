import type {
  AdMarketAd,
  ListAdMarketAdsResponse,
} from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
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
vi.mock("./ads-market-poller", () => ({
  AdsMarketPoller: () => <div data-testid="poller" />,
}));
vi.mock("./ads-market-ad-grid", () => ({
  AdsMarketAdGrid: ({ ads, notice }: { ads: unknown[]; notice?: string }) => (
    <div data-testid="ads" data-notice={notice}>
      {ads.length}
    </div>
  ),
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsMarketAds, AdsMarketResults } from "./ads-market-results";

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
      status: "ready",
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
      screen.getByRole("heading", { name: "Ads from your search competitors" }),
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
    listMarketAdsMock.mockResolvedValue({
      status: "ready",
      ads: [],
      fetchedAt,
    });

    await renderResults();

    expect(
      screen.getByText("No trending keywords found for this market"),
    ).toBeVisible();
    expect(screen.getByText("No competitor ads found")).toBeVisible();
  });

  it("lets a failure that is not Core's reach the route's error boundary", async () => {
    listMarketKeywordsMock.mockRejectedValue(new Error("session lost"));

    await expect(renderResults()).rejects.toThrow("session lost");
  });
});

describe("AdsMarketAds", () => {
  const ad = (creativeId: string): AdMarketAd => ({
    creativeId,
    advertiserId: "a1",
    advertiserName: "Acme Shoes",
    format: "text",
    previewImage: null,
    previewUrl: null,
    firstShown: null,
    lastShown: null,
    verified: false,
  });
  const stale = [ad("old"), ad("older")];

  function renderAds(
    status: ListAdMarketAdsResponse["status"],
    ads: AdMarketAd[] = [],
  ) {
    const result = Promise.resolve({
      data: { status, ads, fetchedAt: ads.length ? fetchedAt : null },
    });
    return act(async () => {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <Suspense>
            <AdsMarketAds result={result} />
          </Suspense>
        </NextIntlClientProvider>,
      );
    });
  }

  it("shows the ads when ready, without polling", async () => {
    await renderAds("ready", stale);

    expect(screen.getByTestId("ads")).toHaveTextContent("2");
    expect(screen.getByTestId("ads")).not.toHaveAttribute("data-notice");
    expect(screen.queryByTestId("poller")).toBeNull();
    expect(screen.queryByText("Refreshing…")).toBeNull();
  });

  it("says it is gathering, and polls, when there are no ads yet", async () => {
    await renderAds("gathering");

    expect(
      screen.getByText("Gathering ads from your search competitors"),
    ).toBeVisible();
    expect(
      screen.getByText("This takes a few minutes. You can leave this page."),
    ).toBeVisible();
    expect(screen.getByTestId("poller")).toBeInTheDocument();
    expect(screen.queryByTestId("ads")).toBeNull();
  });

  it("keeps the previous ads and says it is refreshing while gathering", async () => {
    await renderAds("gathering", stale);

    expect(screen.getByTestId("ads")).toHaveTextContent("2");
    expect(screen.getByTestId("ads")).toHaveAttribute(
      "data-notice",
      "Refreshing…",
    );
    expect(screen.getByTestId("poller")).toBeInTheDocument();
    expect(
      screen.queryByText("Gathering ads from your search competitors"),
    ).toBeNull();
  });

  it("says the lookup failed and will be retried, with no button and no polling", async () => {
    await renderAds("failed");

    expect(screen.getByText("Couldn't gather competitor ads")).toBeVisible();
    expect(screen.getByText("We'll try again within the hour.")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("ads")).toBeNull();
    expect(screen.queryByTestId("poller")).toBeNull();
  });

  it("keeps the previous ads under a failure, noted on their own line", async () => {
    await renderAds("failed", stale);

    expect(screen.getByTestId("ads")).toHaveTextContent("2");
    expect(screen.getByTestId("ads")).toHaveAttribute(
      "data-notice",
      "Couldn't refresh, we'll try again within the hour",
    );
    expect(screen.queryByText("Couldn't gather competitor ads")).toBeNull();
    expect(screen.queryByTestId("poller")).toBeNull();
  });

  it("is a polite live region, busy only while gathering", async () => {
    await renderAds("gathering");
    const region = screen.getByTestId("ads-market-live");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("is not busy once ready", async () => {
    await renderAds("ready", stale);

    expect(screen.getByTestId("ads-market-live")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
});
