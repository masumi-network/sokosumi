import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { TimezoneLabel } from "./timezone-label";

const AT = new Date("2026-10-05T12:00:00Z");

describe("TimezoneLabel", () => {
  it.each([
    ["en", "Central European Summer Time (Prague)"],
    ["de", "Mitteleuropäische Sommerzeit (Prague)"],
    ["es", "hora de verano de Europa central (Prague)"],
  ])("shows the full label in %s", (locale, full) => {
    render(
      <NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
        <TimezoneLabel timeZone="Europe/Prague" at={AT} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(full)).toBeVisible();
  });

  it.each([
    ["en", "GMT+2", "Central European Summer Time (Prague)"],
    ["de", "MESZ", "Mitteleuropäische Sommerzeit (Prague)"],
    ["es", "CEST", "hora de verano de Europa central (Prague)"],
  ])(
    "pairs the short label with a keyboard-accessible full tooltip in %s",
    async (locale, short, full) => {
      const user = userEvent.setup();
      render(
        <NextIntlClientProvider locale={locale} messages={{}} timeZone="UTC">
          <TimezoneLabel timeZone="Europe/Prague" at={AT} variant="short" />
        </NextIntlClientProvider>,
      );
      const label = screen.getByRole("button", { name: short });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      await user.tab();
      expect(label).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(full);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      await user.hover(label);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(full);
    },
  );
});
