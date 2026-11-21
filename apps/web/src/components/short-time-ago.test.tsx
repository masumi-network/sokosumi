import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShortTimeAgo } from "@/components/short-time-ago";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function intl(children: ReactNode, locale = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={{ Components: { TimeAgo: { justNow: "just now" } } }}
    >
      {children}
    </NextIntlClientProvider>
  );
}

describe("ShortTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says 'just now' under a minute and a narrow unit after", () => {
    render(
      intl(
        <>
          <ShortTimeAgo at={ago(33_000)} now={NOW} />|
          <ShortTimeAgo at={ago(2 * 60_000)} now={NOW} />|
          <ShortTimeAgo at={ago(3 * 3_600_000)} now={NOW} />
        </>,
      ),
    );

    expect(document.body.textContent).toBe("just now|2m ago|3h ago");
  });

  // The server and the browser read their clocks at different times, so a
  // label from each would not hydrate (React #418). The server counts from
  // the time the page passes in, which the browser's fallback repeats.
  it("counts from the passed time on the server", () => {
    // An hour on the server's clock does not move the label.
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60_000));

    const html = renderToString(
      intl(<ShortTimeAgo at={ago(5 * 60_000)} now={NOW} />),
    );

    expect(html).toContain("5m ago");
    expect(html).not.toContain("1h ago");
  });

  it("moves every label on screen together, once a minute", () => {
    render(
      intl(
        <>
          <ShortTimeAgo at={ago(10_000)} now={NOW} />|
          <ShortTimeAgo at={ago(60_000)} now={NOW} />
        </>,
      ),
    );
    expect(document.body.textContent).toBe("just now|1m ago");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(document.body.textContent).toBe("1m ago|2m ago");
  });

  it("speaks the reader's language", () => {
    render(intl(<ShortTimeAgo at={ago(3 * 3_600_000)} now={NOW} />, "de"));

    expect(screen.getByText("vor 3 Std.")).toBeInTheDocument();
  });
});
