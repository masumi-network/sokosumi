import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { RESET_PASSWORD_TOKEN_COOKIE_NAME } from "@/lib/reset-password-token";

import { GET } from "./route";

describe("reset password token exchange", () => {
  it("moves the token into an HttpOnly cookie and redirects to a clean URL", async () => {
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.com/reset-password/exchange?token=reset_token_1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/reset-password",
    );
    expect(response.headers.get("location")).not.toContain("reset_token_1");

    const cookie = response.cookies.get(RESET_PASSWORD_TOKEN_COOKIE_NAME);
    expect(cookie?.value).toBe("reset_token_1");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/reset-password");
    expect(cookie?.maxAge).toBe(3600);
  });

  it("rejects a missing token without rendering the reset page", async () => {
    const response = await GET(
      new NextRequest("https://app.sokosumi.com/reset-password/exchange"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/signin",
    );
    expect(
      response.cookies.get(RESET_PASSWORD_TOKEN_COOKIE_NAME),
    ).toBeUndefined();
  });
});
