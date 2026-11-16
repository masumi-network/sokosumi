import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoTrendChart } from "./seo-trend-chart";

describe("SEO trend chart Google updates", () => {
  it("says an update that has no end on the as-of day is still rolling out", () => {
    // 2026-11-08 to 2026-11-15: the November 2026 core update started on 2026-11-10, with no end on 2026-11-13.
    const points = Array.from({ length: 8 }, (_, index) => ({
      date: `2026-11-${String(8 + index).padStart(2, "0")}`,
      value: 1,
    }));
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTrendChart
          points={points}
          unit="count"
          label="Search clicks"
          formatValue={String}
          unavailable="No data"
          series={{ source: "search_console", key: "clicks" }}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        "Google: November 2026 core update, Nov 10, 2026 to Nov 13, 2026, still rolling out",
      ),
    ).toBeInTheDocument();
  });
});
