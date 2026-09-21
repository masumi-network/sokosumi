import { describe, expect, it } from "vitest";

import { redactResetPasswordToken } from "./reset-password-token-redaction";

describe("redactResetPasswordToken", () => {
  it("removes reset tokens from the request URL and parsed query", () => {
    const event = redactResetPasswordToken({
      type: undefined,
      request: {
        url: "https://app.sokosumi.com/reset-password/exchange?token=secret&source=email",
        query_string: { token: "secret", source: "email" },
        headers: {
          referer:
            "https://app.sokosumi.com/reset-password/exchange?token=secret",
          cookie: "theme=dark; sokosumi_reset_password_token=secret; locale=en",
        },
        cookies: {
          theme: "dark",
          sokosumi_reset_password_token: "secret",
        },
      },
    });

    expect(event.request).toEqual({
      url: "https://app.sokosumi.com/reset-password/exchange?source=email",
      query_string: { source: "email" },
      headers: {
        referer: "https://app.sokosumi.com/reset-password/exchange",
        cookie: "theme=dark; locale=en",
      },
      cookies: { theme: "dark" },
    });
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("leaves unrelated URLs unchanged", () => {
    const event = {
      type: undefined,
      request: {
        url: "https://app.sokosumi.com/search?token=public-filter",
      },
    };

    expect(redactResetPasswordToken(event)).toBe(event);
  });
});
