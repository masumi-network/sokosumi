import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoDemandChart } from "./seo-demand-chart";

const market = { countryCode: "US", languageCode: "en" };

describe("SEO keyword demand chart", () => {
  it("draws each bar on the round axis its numbers stand under", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoDemandChart
          demand={{
            rows: [
              { keyword: "macbook battery", ...market, volume: 2400, best: 4 },
              { keyword: "battery widget", ...market, volume: 720, best: null },
              { keyword: "battery app", ...market, volume: 10, best: null },
            ],
            max: 2400,
            manyMarkets: false,
          }}
        />
      </NextIntlClientProvider>,
    );
    const chart = within(screen.getByTestId("seo-demand-chart"));
    const rows = chart.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("bdi")?.textContent)).toEqual([
      "macbook battery",
      "battery widget",
      "battery app",
    ]);
    // The axis ends at 3,000, so 2,400 is 80% of the plot and not its full width.
    expect(
      chart.getAllByTestId("seo-demand-bar").map((bar) => bar.style.width),
    ).toEqual(["80%", "24%", "1%"]);
    expect(within(rows[0]).getByText("2,400")).toBeVisible();
    expect(rows[0]).toHaveAttribute(
      "title",
      "macbook battery: 2,400 searches a month · Position 4",
    );
    // A keyword the check did not find the page for has no position.
    expect(chart.getAllByText(/^Position/)).toHaveLength(1);
    expect(rows[1]).toHaveAttribute(
      "title",
      "battery widget: 720 searches a month",
    );
    for (const tick of ["0", "1K", "2K", "3K"])
      expect(chart.getByText(tick)).toBeInTheDocument();
    // No market per row while every keyword is in one market.
    expect(chart.queryByText(/United States/)).toBeNull();
  });
});
