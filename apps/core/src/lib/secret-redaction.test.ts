import { describe, expect, it } from "vitest";

import {
  collectEnvSecrets,
  REDACTED_SECRET,
  redactDeep,
  redactSecrets,
} from "./secret-redaction.js";

describe("collectEnvSecrets", () => {
  it("collects values of secret-named variables", () => {
    const secrets = collectEnvSecrets({
      PAYMENT_API_KEY: "paykey_abcdef123456",
      BETTER_AUTH_SECRET: "authsecret_abcdef",
      HERMES_ORCH_TOKEN: "token_abcdef1234",
      DATABASE_PASSWORD: "password_abcdef12",
    });

    expect(secrets).toHaveLength(4);
    expect(secrets).toContain("paykey_abcdef123456");
    expect(secrets).toContain("password_abcdef12");
  });

  it("ignores variables that are not credentials", () => {
    // A redactor that masks the app URL blanks out most of every log line.
    const secrets = collectEnvSecrets({
      PAYMENT_API_URL: "https://payment.example.com",
      NODE_ENV: "production",
      SENTRY_DSN: "https://abc@o1.ingest.sentry.io/2",
    });

    expect(secrets).toEqual([]);
  });

  it("keeps publishable keys readable", () => {
    // Masking a public key hides information an operator needs and protects
    // nothing, since the value is published by definition.
    const secrets = collectEnvSecrets({
      BLOB_WEBHOOK_PUBLIC_KEY: "public_abcdef123456",
    });

    expect(secrets).toEqual([]);
  });

  it("skips values too short to be key material", () => {
    // A placeholder in a secret-named variable would otherwise blank out
    // every unrelated occurrence of that word. `local-test` is the real
    // ABLY_PUBLISH_ONLY_KEY value in this repo's own test setup.
    const secrets = collectEnvSecrets({
      CRON_SECRET: "dev",
      ABLY_PUBLISH_ONLY_KEY: "local-test",
    });

    expect(secrets).toEqual([]);
  });

  it("orders longest first so a nested secret is masked whole", () => {
    // The short value sits inside the longer one. Masking it first
    // would leave the remainder of the long one in the text.
    const secrets = collectEnvSecrets({
      SHORT_TOKEN: "abcdefgh_abcdefgh",
      LONG_TOKEN: "abcdefgh_abcdefgh_and_more",
    });

    expect(secrets[0]).toBe("abcdefgh_abcdefgh_and_more");
    expect(redactSecrets("abcdefgh_abcdefgh_and_more", secrets)).toBe(
      REDACTED_SECRET,
    );
  });
});

describe("redactSecrets", () => {
  it("masks every occurrence", () => {
    const result = redactSecrets("key=s3cret_value and again s3cret_value", [
      "s3cret_value",
    ]);

    expect(result).toBe(`key=${REDACTED_SECRET} and again ${REDACTED_SECRET}`);
    expect(result).not.toContain("s3cret_value");
  });

  it("masks a secret containing regex metacharacters", () => {
    // Key material is arbitrary bytes. A redactor built on RegExp would stop
    // matching here, silently, which is the failure mode that matters.
    const secret = "sk_live_a+b.c*d(e)[f]";

    expect(redactSecrets(`token: ${secret}`, [secret])).toBe(
      `token: ${REDACTED_SECRET}`,
    );
  });

  it("leaves text alone when no secret is present", () => {
    expect(redactSecrets("api-key-status 502: Bad Gateway", ["s3cret"])).toBe(
      "api-key-status 502: Bad Gateway",
    );
  });
});

describe("redactDeep", () => {
  it("masks a secret echoed inside a Sentry event", () => {
    // The shape this exists for: a gateway 502 body echoing the request
    // headers, dumped by extractNodeErrorMessage into the event message.
    const event = {
      message: "x402 readiness check failed",
      exception: {
        values: [
          {
            type: "Error",
            value: 'api-key-status 502: {"headers":{"token":"paykey_secret1"}}',
          },
        ],
      },
      breadcrumbs: [{ message: "sent token paykey_secret1" }],
    };

    const result = redactDeep(event, ["paykey_secret1"]);

    expect(JSON.stringify(result)).not.toContain("paykey_secret1");
    expect(result.exception.values[0].value).toContain(REDACTED_SECRET);
    expect(result.breadcrumbs[0].message).toContain(REDACTED_SECRET);
    expect(result.message).toBe("x402 readiness check failed");
  });

  it("does not mutate the input", () => {
    const event = { message: "paykey_secret1" };

    redactDeep(event, ["paykey_secret1"]);

    expect(event.message).toBe("paykey_secret1");
  });

  it("returns the value unchanged when there are no secrets", () => {
    const event = { message: "nothing to hide" };

    expect(redactDeep(event, [])).toBe(event);
  });

  it("survives a cyclic event without hanging", () => {
    const event: Record<string, unknown> = { message: "paykey_secret1" };
    event.self = event;

    const result = redactDeep(event, ["paykey_secret1"]) as Record<
      string,
      unknown
    >;

    expect(result.message).toBe(REDACTED_SECRET);
  });

  it("leaves non-plain objects intact", () => {
    // Rebuilding a Date as a plain object would corrupt the event.
    const stamp = new Date("2026-08-28T00:00:00.000Z");

    const result = redactDeep({ stamp }, ["paykey_secret1"]);

    expect(result.stamp).toBe(stamp);
  });
});
