import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SocialError from "./error";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `App.Social.${key}`,
}));

describe("SocialError", () => {
  it("names the failure and retries the page", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<SocialError error={new Error("load failed")} reset={reset} />);

    expect(screen.getByTestId("social-error")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "App.Social.error.title" }),
    ).toBeVisible();
    expect(screen.getByText("App.Social.error.description")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "App.Social.error.retry" }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
