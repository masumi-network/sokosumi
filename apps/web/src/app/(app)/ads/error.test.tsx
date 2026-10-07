import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import AdsError from "./error";

describe("AdsError", () => {
  it("says what went wrong and retries on request", async () => {
    const reset = vi.fn();
    render(<AdsError error={new Error("boom")} reset={reset} />);

    expect(screen.getByText("error.title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "error.retry" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
