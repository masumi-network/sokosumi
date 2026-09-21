import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
const getResetPasswordTokenMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/reset-password-token-cookie", () => ({
  getResetPasswordToken: () => getResetPasswordTokenMock(),
}));

vi.mock("./components/form", () => ({
  __esModule: true,
  default: () => <div data-testid="reset-password-form" />,
}));

vi.mock("./components/header", () => ({
  __esModule: true,
  default: () => <div data-testid="reset-password-header" />,
}));

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getResetPasswordTokenMock.mockResolvedValue("reset_token_1");
  });

  it("blocks the reset form from Sentry Replay", async () => {
    const { default: ResetPasswordPage } = await import("./page");

    const { container } = render(
      await ResetPasswordPage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.querySelector("[data-sentry-block]")).not.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
