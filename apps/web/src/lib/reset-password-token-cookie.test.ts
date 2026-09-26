import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const cookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: cookieGet,
    set: cookieSet,
  }),
}));

import { RESET_PASSWORD_TOKEN_COOKIE_NAME } from "./reset-password-token";
import {
  applyResetPasswordTokenCookie,
  clearResetPasswordToken,
  getResetPasswordToken,
} from "./reset-password-token-cookie";

describe("reset password token cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a short-lived HttpOnly cookie scoped to the reset flow", () => {
    const set = vi.fn();

    applyResetPasswordTokenCookie({ set }, "reset_token_1", true);

    expect(set).toHaveBeenCalledWith({
      name: RESET_PASSWORD_TOKEN_COOKIE_NAME,
      value: "reset_token_1",
      httpOnly: true,
      sameSite: "lax",
      path: "/reset-password",
      secure: true,
      maxAge: 3600,
    });
  });

  it("does not store malformed tokens", () => {
    const set = vi.fn();

    applyResetPasswordTokenCookie({ set }, "token with spaces", true);

    expect(set).not.toHaveBeenCalled();
  });

  it("reads a usable token", async () => {
    cookieGet.mockReturnValue({ value: "reset_token_1" });

    await expect(getResetPasswordToken()).resolves.toBe("reset_token_1");
  });

  it("clears the reset token at the same cookie path", async () => {
    await clearResetPasswordToken();

    expect(cookieSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: RESET_PASSWORD_TOKEN_COOKIE_NAME,
        value: "",
        path: "/reset-password",
        maxAge: 0,
      }),
    );
  });
});
