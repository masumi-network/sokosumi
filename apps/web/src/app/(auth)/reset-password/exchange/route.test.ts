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

  // Better Auth sends an expired or used link back without a token.
  it("sends a dead link to request a new one, with a notice", async () => {
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.com/reset-password/exchange?error=INVALID_TOKEN",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/forgot-password?error=INVALID_TOKEN",
    );
    expect(
      response.cookies.get(RESET_PASSWORD_TOKEN_COOKIE_NAME),
    ).toBeUndefined();
  });

  it("treats an unusable token like a dead link", async () => {
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.com/reset-password/exchange?token=has%20space",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/forgot-password?error=INVALID_TOKEN",
    );
  });

  it("keeps where the person was going", async () => {
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.com/reset-password/exchange?returnUrl=%2Fchat&token=reset_token_1",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.com/reset-password?returnUrl=%2Fchat",
    );
  });

  // A CMO sign-in sent the person here; the new password must lead back.
  it("keeps the signed OAuth request through both outcomes", async () => {
    const oauthQuery = "client_id=cmo&exp=1900000000&sig=abc%2B%2F%3D";

    const valid = await GET(
      new NextRequest(
        `https://app.sokosumi.com/reset-password/exchange?${oauthQuery}&token=reset_token_1`,
      ),
    );
    const dead = await GET(
      new NextRequest(
        `https://app.sokosumi.com/reset-password/exchange?${oauthQuery}&error=INVALID_TOKEN`,
      ),
    );

    expect(valid.headers.get("location")).toBe(
      `https://app.sokosumi.com/reset-password?${oauthQuery}`,
    );
    expect(dead.headers.get("location")).toBe(
      `https://app.sokosumi.com/forgot-password?${oauthQuery}&error=INVALID_TOKEN`,
    );
  });
});
