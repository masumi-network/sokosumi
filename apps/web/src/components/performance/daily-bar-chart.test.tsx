import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { DailyBarChart } from "./daily-bar-chart";

describe("shared daily performance bars", () => {
  it("keeps missing values distinct from zero and exposes daily values without list-item semantics", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">
        <DailyBarChart
          label="Opens"
          unavailable="Unavailable"
          points={[
            { date: "2026-10-01", value: null },
            { date: "2026-10-02", value: 0 },
            { date: "2026-10-03", value: 5 },
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("figure", { name: "Opens" })).toBeVisible();
    expect(
      screen.getByTitle("Oct 1: Unavailable").firstElementChild,
    ).toHaveClass("border-dashed");
    expect(screen.getByTitle("Oct 2: 0").firstElementChild).toHaveClass("h-px");
    expect(screen.getByTitle("Oct 3: 5").firstElementChild).toHaveStyle({
      height: "100%",
    });
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
  it("places losses below the zero baseline without changing the values", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">
        <DailyBarChart
          label="Net growth"
          unavailable="Unavailable"
          points={[
            { date: "2026-10-01", value: 3 },
            { date: "2026-10-02", value: -1 },
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTitle("Oct 1: 3").firstElementChild).toHaveStyle({
      bottom: "25%",
      height: "75%",
    });
    expect(screen.getByTitle("Oct 2: -1").firstElementChild).toHaveStyle({
      bottom: "0%",
      height: "25%",
    });
  });
  it("keeps a full year of bars and accessible daily values within a responsive gap budget", () => {
    const points = Array.from({ length: 366 }, (_, day) => ({
      date: new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10),
      value: 1,
    }));
    render(
      <NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">
        <DailyBarChart
          label="A year"
          unavailable="Unavailable"
          points={points}
        />
      </NextIntlClientProvider>,
    );
    const figure = screen.getByRole("figure", { name: "A year" });
    const track = figure.firstElementChild;
    expect(track?.children).toHaveLength(366);
    expect(track).not.toHaveClass("gap-px");
    expect(track).toHaveStyle({ columnGap: `min(1px, ${25 / 366}%)` });
    expect(figure.querySelectorAll(".sr-only p")).toHaveLength(366);
  });
});
