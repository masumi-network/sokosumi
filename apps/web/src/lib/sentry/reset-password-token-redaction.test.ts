import { describe, expect, it } from "vitest";

import { beforeSendServerEvent } from "./expected-request-errors";
import { redactResetPasswordToken } from "./reset-password-token-redaction";
import { beforeSendClientEvent } from "./third-party-fetch-errors";

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

  it("removes the token from streamed span name and attributes", () => {
    const span = redactResetPasswordToken({
      name: "GET /reset-password/exchange?token=secret",
      attributes: {
        "url.full":
          "https://app.sokosumi.com/reset-password/exchange?token=secret",
        "http.route": "/reset-password/exchange",
      },
    });

    expect(span.name).not.toContain("secret");
    expect(span.attributes?.["url.full"]).toBe(
      "https://app.sokosumi.com/reset-password/exchange",
    );
    expect(JSON.stringify(span)).not.toContain("secret");
  });

  it("removes the token from every field in a transaction payload", () => {
    const transaction = {
      type: "transaction" as const,
      request: undefined,
      breadcrumbs: [
        {
          data: {
            url: "https://app.sokosumi.com/reset-password/exchange?token=secret",
          },
        },
      ],
      spans: [
        {
          data: {
            "url.full":
              "https://app.sokosumi.com/reset-password/exchange?token=secret",
          },
        },
      ],
      contexts: {
        trace: {
          data: { resetToken: "secret" },
        },
      },
    };
    const event = redactResetPasswordToken(transaction);

    expect(JSON.stringify(event)).not.toContain("secret");
    expect(event.breadcrumbs?.[0]?.data?.url).toBe(
      "https://app.sokosumi.com/reset-password/exchange",
    );
    expect(event.spans?.[0]?.data?.["url.full"]).toBe(
      "https://app.sokosumi.com/reset-password/exchange",
    );
  });

  it.each([
    ["client", beforeSendClientEvent],
    ["server", beforeSendServerEvent],
  ])("redacts the complete payload through the %s hook", (_name, hook) => {
    const event = {
      type: undefined,
      request: {
        url: "https://app.sokosumi.com/reset-password/exchange?token=secret",
      },
      breadcrumbs: [
        {
          data: {
            url: "https://app.sokosumi.com/reset-password/exchange?token=secret",
          },
        },
      ],
    };

    expect(JSON.stringify(hook(event, {}))).not.toContain("secret");
  });
});
