import type { AdMarketProfile } from "@sokosumi/core-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveAdsMarketProfile } from "@/lib/actions/ads/action";
import { marketOptions } from "@/lib/ads/market";
import messages from "../../../../../messages/en.json";
import { AdsMarketProfile } from "./ads-market-profile";
import {
  AdsMarketRefresh,
  AdsMarketUpdating,
  MARKET_REFRESH_WAIT_MS,
} from "./ads-market-refresh";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/actions/ads/action", () => ({ saveAdsMarketProfile: vi.fn() }));

const saveMock = vi.mocked(saveAdsMarketProfile);

const SHOWN: AdMarketProfile = {
  keywords: ["running shoes", "trail shoes"],
  countryCode: "DE",
  locationId: "2276",
  languageCode: "de",
  updatedAt: new Date("2026-10-01T10:00:00.000Z"),
};
const SAVED: AdMarketProfile = {
  ...SHOWN,
  keywords: ["running shoes"],
  updatedAt: new Date("2026-10-01T10:05:00.000Z"),
};
const OLD_SUMMARY = "running shoes, trail shoes · Germany · German";
const NEW_SUMMARY = "running shoes · Germany · German";

/** The market page as the server renders it, showing `shown`. */
function page(shown: AdMarketProfile) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsMarketRefresh shownUpdatedAt={shown.updatedAt}>
        <AdsMarketProfile
          {...marketOptions("en")}
          profile={shown}
          projectId="project-1"
          summary={shown === SHOWN ? OLD_SUMMARY : NEW_SUMMARY}
        />
        <AdsMarketUpdating>
          <p>{shown === SHOWN ? "old results" : "new results"}</p>
        </AdsMarketUpdating>
      </AdsMarketRefresh>
    </NextIntlClientProvider>
  );
}

const results = () => screen.getByTestId("ads-market-results");
const status = () => screen.getByRole("status");

async function saveWithoutTrailShoes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit market" }));
  await user.click(
    await screen.findByRole("button", { name: "Remove trail shoes" }),
  );
  await user.click(screen.getByRole("button", { name: "Save market" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("a market save while the page catches up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the saved keywords at once and dims the old results until the new ones arrive", async () => {
    saveMock.mockResolvedValue({ ok: true, value: { profile: SAVED } });
    const user = userEvent.setup();
    const { rerender } = render(page(SHOWN));
    expect(status()).toBeEmptyDOMElement();
    expect(results()).toHaveAttribute("aria-busy", "false");

    await saveWithoutTrailShoes(user);

    expect(screen.getByText(NEW_SUMMARY)).toBeVisible();
    expect(screen.queryByText(OLD_SUMMARY)).toBeNull();
    expect(status()).toHaveTextContent("Updating trending keywords…");
    expect(results()).toHaveAttribute("aria-busy", "true");
    expect(results()).toHaveTextContent("old results");

    rerender(page(SAVED));

    expect(status()).toBeEmptyDOMElement();
    expect(results()).toHaveAttribute("aria-busy", "false");
    expect(results()).toHaveTextContent("new results");
    expect(screen.getByText(NEW_SUMMARY)).toBeVisible();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("changes nothing when the save fails, so a retry starts clean", async () => {
    saveMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "x", message: "Core text" },
    } as Awaited<ReturnType<typeof saveAdsMarketProfile>>);
    const user = userEvent.setup();
    render(page(SHOWN));

    await user.click(screen.getByRole("button", { name: "Edit market" }));
    await user.click(
      await screen.findByRole("button", { name: "Remove trail shoes" }),
    );
    await user.click(screen.getByRole("button", { name: "Save market" }));
    expect(await screen.findByText("Failed to save market")).toBeVisible();
    // The dialog hides the page from assistive tech while it is open.
    expect(screen.getByRole("status", { hidden: true })).toBeEmptyDOMElement();
    expect(results()).toHaveAttribute("aria-busy", "false");

    saveMock.mockResolvedValueOnce({ ok: true, value: { profile: SAVED } });
    await user.click(screen.getByRole("button", { name: "Save market" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(status()).toHaveTextContent("Updating trending keywords…");
  });

  /** Saves, then lets the wait for the page run out with it still behind. */
  async function saveAndOutwait() {
    saveMock.mockResolvedValue({ ok: true, value: { profile: SAVED } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime.bind(vi),
      });
      const view = render(page(SHOWN));
      await saveWithoutTrailShoes(user);
      expect(results()).toHaveAttribute("aria-busy", "true");

      act(() => vi.advanceTimersByTime(MARKET_REFRESH_WAIT_MS));
      return { user: userEvent.setup(), ...view };
    } finally {
      vi.useRealTimers();
    }
  }

  it("keeps the saved summary and marks the results stale when the refresh never lands", async () => {
    await saveAndOutwait();

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(NEW_SUMMARY)).toBeVisible();
    expect(screen.queryByText(OLD_SUMMARY)).toBeNull();
    expect(status()).toHaveTextContent(
      "These results are from before your last save.",
    );
    expect(results()).toHaveAttribute("aria-busy", "false");
    expect(results()).toHaveAttribute("data-results", "stale");
    expect(results()).toHaveTextContent("old results");
  });

  it("refreshes stale results on request and clears once the saved market's arrive", async () => {
    const { user, rerender } = await saveAndOutwait();
    refreshMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Refresh results" }));

    expect(refreshMock).toHaveBeenCalledTimes(1);
    rerender(page(SAVED));
    expect(status()).toBeEmptyDOMElement();
    expect(results()).toHaveAttribute("data-results", "current");
    expect(results()).toHaveTextContent("new results");
    expect(screen.getByText(NEW_SUMMARY)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Refresh results" }),
    ).toBeNull();
  });

  it("waits afresh after another save while stale", async () => {
    const { user } = await saveAndOutwait();
    const later = { ...SAVED, updatedAt: new Date("2026-10-01T10:09:00Z") };
    saveMock.mockResolvedValue({ ok: true, value: { profile: later } });

    await user.click(screen.getByRole("button", { name: "Edit market" }));
    await user.click(screen.getByRole("button", { name: "Save market" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(status()).toHaveTextContent("Updating trending keywords…");
    expect(results()).toHaveAttribute("aria-busy", "true");
  });
});
