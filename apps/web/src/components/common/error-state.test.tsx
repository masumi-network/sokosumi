import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { errorId?: string }) =>
    key === "errorId" && values?.errorId ? `Error ID: ${values.errorId}` : key,
}));

import { CORE_AUTH_UNAVAILABLE_ERROR_DIGEST } from "@/lib/auth/errors";

import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("shows the card, reports to Sentry, and retries", async () => {
    const onRetry = vi.fn();
    const error: Error & { digest?: string } = new Error("boom");
    error.digest = "digest-1";

    render(
      <ErrorState
        description="description"
        error={error}
        onRetry={onRetry}
        secondaryHref="/"
        secondaryLabel="goApp"
        title="title"
      />,
    );

    expect(screen.getByText("title")).toBeVisible();
    expect(screen.getByText("description")).toBeVisible();
    expect(screen.getByText("notified")).toBeVisible();
    expect(screen.getByText("Error ID: digest-1")).toBeVisible();
    expect(screen.getByRole("link", { name: "goApp" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { digest: "digest-1" },
    });

    await userEvent.click(screen.getByRole("button", { name: "tryAgain" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("skips Sentry and the notified line for a Core stall", () => {
    const error: Error & { digest?: string } = new Error("masked");
    error.digest = CORE_AUTH_UNAVAILABLE_ERROR_DIGEST;

    render(
      <ErrorState
        description="unavailableDescription"
        error={error}
        onRetry={vi.fn()}
        title="unavailableTitle"
      />,
    );

    expect(screen.getByText("unavailableTitle")).toBeVisible();
    expect(screen.queryByText("notified")).not.toBeInTheDocument();
    expect(
      screen.getByText(`Error ID: ${CORE_AUTH_UNAVAILABLE_ERROR_DIGEST}`),
    ).toBeVisible();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("hides the error ID when there is no digest", () => {
    render(
      <ErrorState
        description="description"
        error={new Error("boom")}
        onRetry={vi.fn()}
        title="title"
      />,
    );

    expect(screen.queryByText(/Error ID:/)).not.toBeInTheDocument();
  });
});
