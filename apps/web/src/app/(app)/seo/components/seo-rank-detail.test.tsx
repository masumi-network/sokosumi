import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import english from "../../../../../messages/en.json";
import { SeoRankDetailRow } from "./seo-rank-detail";

afterEach(cleanup);

it("reports the rank, market and local observation day in English while keeping the query and navigation in their own languages", () => {
  render(
    <NextIntlClientProvider
      locale="de"
      messages={german}
      timeZone="Europe/Berlin"
    >
      <SeoResultMessagesProvider messages={english.App.Seo}>
        <SeoRankDetailRow
          headingId="rank"
          detail={{
            keyword: "鞄 修理",
            country: "JP",
            language: "ja",
            device: "mobile",
            readAt: new Date("2026-11-01T23:30:00Z"),
            result: { kind: "absent", top: 15 },
            searchConsole: { kind: "searchConsole", position: 8.5 },
            aiOverviewCites: false,
            others: [],
          }}
          evidence={[]}
          onShowRankings={vi.fn()}
        />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("鞄 修理")).toBeVisible();
  expect(screen.getByText("Search Console average position 8.5")).toBeVisible();
  expect(
    screen.getByText("Google · Japan · Japanese", { exact: false }),
  ).toHaveTextContent("Nov 2, 2026");
  expect(
    screen.getByRole("button", {
      name: german.App.Seo.overview.rank.showRankings,
    }),
  ).toBeVisible();
});
