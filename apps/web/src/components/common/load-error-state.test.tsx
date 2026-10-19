import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoadErrorState } from "./load-error-state";

const props = {
  title: "Couldn't load accounts",
  description:
    "Everything else still works. Check your connection and try again.",
  retryLabel: "Try again",
};

describe("LoadErrorState", () => {
  it("reads like an empty state: icon, title, one line of help and a retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <LoadErrorState {...props} data-testid="failed" onRetry={onRetry} />,
    );

    const failed = screen.getByTestId("failed");
    expect(failed).toHaveAttribute("role", "alert");
    expect(
      within(failed).getByRole("heading", { name: "Couldn't load accounts" }),
    ).toBeVisible();
    expect(within(failed).getByText(props.description)).toBeVisible();
    // The icon is decoration: the title already says what failed.
    expect(failed.querySelector("svg[aria-hidden]")).not.toBeNull();

    const retry = within(failed).getByRole("button", { name: "Try again" });
    expect(retry.querySelector("svg[aria-hidden]")).not.toBeNull();
    // 44px target on a phone, the usual 40px from the desktop breakpoint up.
    expect(retry).toHaveClass("min-h-11", "md:min-h-10");
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the retry focusable and busy, not removed, while it runs", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<LoadErrorState {...props} retrying onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    retry.focus();
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("is a slim polite banner without a heading when it sits above content", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <LoadErrorState
        {...props}
        data-testid="banner"
        variant="banner"
        onRetry={onRetry}
      />,
    );

    const banner = screen.getByTestId("banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(within(banner).queryByRole("heading")).not.toBeInTheDocument();
    expect(banner).toHaveTextContent("Couldn't load accounts");
    expect(banner).toHaveTextContent(props.description);
    expect(banner).toHaveClass("rounded-lg", "border");
    await user.click(within(banner).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
