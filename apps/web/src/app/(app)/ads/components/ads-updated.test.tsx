import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsUpdated } from "./ads-updated";

function renderUpdated(at: Date | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsUpdated at={at} />
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

    expect(screen.getByText(/^Updated/)).toBeVisible();
    expect(screen.queryByText(/\bin\b/)).toBeNull();
  });

  it("says nothing without a fetch time", () => {
    const { container } = renderUpdated(null);

    expect(container).toBeEmptyDOMElement();
  });
});
