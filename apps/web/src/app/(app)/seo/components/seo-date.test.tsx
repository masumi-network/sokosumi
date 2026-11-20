import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import english from "../../../../../messages/en.json";
import { SeoDate, SeoPeriod } from "./seo-date";

it("uses English report dates while keeping the member's time zone and 24-hour clock", () => {
  render(
    <NextIntlClientProvider
      locale="de"
      messages={german}
      timeZone="America/Los_Angeles"
      formats={createFormats("h23")}
    >
      <SeoResultMessagesProvider messages={english.App.Seo} hourCycle="h23">
        <SeoDate report value="2026-11-28T06:30:00Z" />
        <SeoPeriod report from="2026-11-27" to="2026-11-28" />
        <SeoDate value={null} />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/Nov 27, 2026.*22:30/)).toHaveAttribute("lang", "en");
  expect(screen.getByText(/Nov 27.*28, 2026/)).toHaveAttribute("lang", "en");
  expect(screen.getByText(german.App.Seo.none)).toBeInTheDocument();
});
