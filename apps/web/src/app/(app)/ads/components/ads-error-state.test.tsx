import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsErrorState } from "./ads-error-state";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderState(kind: "unavailable" | "failed") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsErrorState
        failedTitle="Failed to load things"
        kind={kind}
        unavailableTitle="Things aren't available yet"
      />
    </NextIntlClientProvider>,
  );
}

describe("AdsErrorState", () => {
  it("says what is not set up, with nothing to retry", () => {
    renderState("unavailable");

    expect(screen.getByText("Things aren't available yet")).toBeVisible();
    expect(
      screen.getByText("It is not set up for Sokosumi yet."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names what failed and offers to try again by refreshing", async () => {
    const user = userEvent.setup();
    renderState("failed");

    expect(screen.getByText("Failed to load things")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshMock).toHaveBeenCalled();
  });
});
