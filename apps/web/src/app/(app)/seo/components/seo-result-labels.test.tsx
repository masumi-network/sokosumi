import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import english from "../../../../../messages/en.json";
import { SeoBarNumber, SeoSeverity } from "./seo-shared";

it("uses English for an audit row's impact and search count in a German workspace", () => {
  render(
    <NextIntlClientProvider locale="de" messages={german} timeZone="UTC">
      <SeoResultMessagesProvider messages={english.App.Seo}>
        <SeoSeverity severity="major" />
        <SeoBarNumber value={1234} max={2000} unit="searches a month" />
      </SeoResultMessagesProvider>
    </NextIntlClientProvider>,
  );
  expect(screen.getByTitle(english.App.Seo.severityHint.major)).toHaveAttribute(
    "lang",
    "en",
  );
  expect(screen.getByText("1,234")).toHaveTextContent("1,234searches a month");
});
