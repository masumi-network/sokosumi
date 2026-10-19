import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import en from "../../../../../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("linked account details load error", () => {
  it("asks the viewer to check the connection and retry", () => {
    const catalog = en.App.Account.LinkedAccounts;
    render(
      <CoreAuthReadRetry
        description={catalog.loadError}
        retryLabel={catalog.retry}
        title={catalog.loadErrorTitle}
      />,
    );

    expect(screen.getByText("Could not load account details")).toBeVisible();
    expect(
      screen.getByText("Check your connection and try again."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
