import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TimeAgo } from "@/components/time-ago";
import { createFormats } from "@/i18n/time-format";
import type { TestFormatterOptions } from "@/test/intl-formatter";

function intl(
  children: ReactNode,
  { locale = "en", timeZone = "UTC", hourCycle }: TestFormatterOptions = {},
) {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      formats={createFormats(hourCycle)}
    >
      {children}
    </NextIntlClientProvider>
  );
}

describe("TimeAgo", () => {
  it("renders a stable absolute date in the request zone on the server (no effects)", () => {
    // SSR emits the Suspense fallback: a deterministic absolute date rather
    // than a clock-dependent relative string (Sentry SOKOSUMI-A).
    const date = new Date("2026-04-15T10:00:00.000Z");

    const markup = renderToStaticMarkup(intl(<TimeAgo date={date} strict />));

    expect(markup).toContain("Apr 15, 10:00");
    expect(markup).not.toMatch(/ago/);
    expect(markup).toContain(date.toISOString());
  });

  it("swaps to the live relative string after mount on the client", () => {
    const date = new Date(Date.now() - 60_000);

    // Client render: `use(browser())` does not suspend, so the relative label applies.
    render(intl(<TimeAgo date={date} strict />));

    expect(screen.getByText(/ago$/)).toBeInTheDocument();
  });

  it("localizes the post-mount relative string to the active locale", () => {
    const date = new Date(Date.now() - 60_000);

    render(intl(<TimeAgo date={date} strict />, { locale: "de" }));

    // German "vor 1 Minute" rather than the English "1 minute ago".
    expect(screen.getByText(/^vor /)).toBeInTheDocument();
  });

  it("localizes the SSR-stable absolute fallback to the active locale", () => {
    const date = new Date("2026-04-15T10:00:00.000Z");

    const markup = renderToStaticMarkup(
      intl(<TimeAgo date={date} strict />, { locale: "de" }),
    );

    // German formatting drops the comma the English "Apr 15, 10:00" uses.
    expect(markup).toContain("15. Apr.");
    expect(markup).not.toMatch(/ago|vor/);
  });

  it("renders the SSR-stable absolute fallback in the viewer's zone", () => {
    const date = new Date("2026-04-15T10:00:00.000Z");

    const markup = renderToStaticMarkup(
      intl(<TimeAgo date={date} strict />, { timeZone: "Europe/Berlin" }),
    );

    expect(markup).toContain("Apr 15, 12:00");
  });

  it("writes the SSR-stable absolute fallback in the viewer's hour cycle", () => {
    // 14:50 UTC is 16:50 in Berlin during CEST.
    const date = new Date("2026-09-15T14:50:00.000Z");

    const markup24h = renderToStaticMarkup(
      intl(<TimeAgo date={date} strict />, {
        timeZone: "Europe/Berlin",
        hourCycle: "h23",
      }),
    );
    const markup12h = renderToStaticMarkup(
      intl(<TimeAgo date={date} strict />, {
        timeZone: "Europe/Berlin",
        hourCycle: "h12",
      }),
    );

    expect(markup24h).toContain("Sep 15, 16:50");
    expect(markup12h).toContain("Sep 15, 4:50 PM");
  });

  it("renders an em dash for an invalid date", () => {
    render(intl(<TimeAgo date="not-a-date" />));

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
