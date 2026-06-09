import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TimeAgo } from "@/components/time-ago";

describe("TimeAgo", () => {
  it("renders a stable, UTC-pinned absolute date on the server (no effects)", () => {
    // The server render (and the matching first client render) must emit a
    // deterministic absolute date rather than a clock-dependent relative
    // string, otherwise SSR and hydration diverge (Sentry SOKOSUMI-A).
    const date = new Date("2026-04-15T10:00:00.000Z");

    const markup = renderToStaticMarkup(<TimeAgo date={date} strict />);

    expect(markup).toContain("Apr 15, 10:00");
    expect(markup).not.toMatch(/ago/);
    expect(markup).toContain(date.toISOString());
  });

  it("swaps to the live relative string after mount on the client", () => {
    const date = new Date(Date.now() - 60_000);

    // Testing Library flushes effects, so the post-mount relative label applies.
    render(<TimeAgo date={date} strict />);

    expect(screen.getByText(/ago$/)).toBeInTheDocument();
  });

  it("renders an em dash for an invalid date", () => {
    render(<TimeAgo date="not-a-date" />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
