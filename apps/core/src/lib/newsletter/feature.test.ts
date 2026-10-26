import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertNewsletterEnabled, isNewsletterEnabled } from "./feature";

const newsletterEnv = vi.hoisted(() => ({ NEWSLETTER_ENABLED: false }));

vi.mock("@/config/env", () => ({ getEnv: () => newsletterEnv }));

beforeEach(() => {
  newsletterEnv.NEWSLETTER_ENABLED = false;
});

describe("newsletter feature flag", () => {
  it.each([false, true])("reports enabled=%s", (enabled) => {
    newsletterEnv.NEWSLETTER_ENABLED = enabled;

    expect(isNewsletterEnabled()).toBe(enabled);
  });

  it("throws a 404 HTTP error when disabled", () => {
    expect(assertNewsletterEnabled).toThrow(HTTPException);
    expect(assertNewsletterEnabled).toThrow(
      expect.objectContaining({
        status: 404,
        message: "Newsletter is not enabled",
      }),
    );
  });

  it("allows access when enabled", () => {
    newsletterEnv.NEWSLETTER_ENABLED = true;

    expect(assertNewsletterEnabled).not.toThrow();
  });
});
