import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsUpdated } from "./ads-updated";

function renderUpdated(at: Date | null, notice?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsUpdated at={at} notice={notice} />
    </NextIntlClientProvider>,
  );
}

describe("AdsUpdated", () => {
  it("says how long ago the data was fetched", () => {
    renderUpdated(new Date(Date.now() - 2 * 60 * 60 * 1000));

    expect(screen.getByText("Updated 2 hours ago")).toBeVisible();
  });

  it("never reads in the future when Core's clock is ahead", () => {
    renderUpdated(new Date(Date.now() + 25_000));

    expect(screen.getByText("Updated now")).toBeVisible();
  });

  it("adds a notice to the same line", () => {
    renderUpdated(new Date(Date.now() - 2 * 60 * 60 * 1000), "Refreshing…");

    expect(screen.getByText("Updated 2 hours ago · Refreshing…")).toBeVisible();
  });

  it("shows a notice alone without a fetch time", () => {
    renderUpdated(null, "Refreshing…");

    expect(screen.getByText("Refreshing…")).toBeVisible();
  });

  it("says nothing without a fetch time or notice", () => {
    const { container } = renderUpdated(null);

    expect(container).toBeEmptyDOMElement();
  });
});
