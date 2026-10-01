import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsMarketError } from "./ads-market-error";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderError(
  kind: "unavailable" | "failed",
  section: "profile" | "keywords" | "ads" = "keywords",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsMarketError kind={kind} section={section} />
    </NextIntlClientProvider>,
  );
}

describe("AdsMarketError", () => {
  it("says market data is not set up yet, with nothing to retry", () => {
    renderError("unavailable");

    expect(screen.getByText("Market data isn't available yet")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["keywords" as const, "Failed to load keywords"],
    ["ads" as const, "Failed to load ads"],
    ["profile" as const, "Failed to load your market"],
  ])("names the %s section that failed", (section, title) => {
    renderError("failed", section);

    expect(screen.getByText(title)).toBeVisible();
  });

  it("offers to try again by refreshing the page", async () => {
    const user = userEvent.setup();
    renderError("failed");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshMock).toHaveBeenCalled();
  });
});
