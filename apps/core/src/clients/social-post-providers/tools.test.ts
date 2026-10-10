import { describe, expect, it } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  guardSocialCreateOutcome,
} from "./tools";

describe("ComposioToolError", () => {
  it("redacts tokens, urls, and session ids from the stored provider message", () => {
    const error = new ComposioToolError({
      message: "X rejected the post",
      providerMessage:
        "Bearer supersecret https://graph.facebook.com/v19.0/me sess_abc123def token=leakvalue",
      providerStatus: 403,
    });
    expect(error.providerStatus).toBe(403);
    expect(error.providerMessage).toContain("Bearer [redacted]");
    expect(error.providerMessage).toContain("[redacted-url]");
    expect(error.providerMessage).not.toContain("supersecret");
    expect(error.providerMessage).not.toContain("graph.facebook.com");
    expect(error.providerMessage).not.toContain("sess_abc123def");
  });
});

describe("guardSocialCreateOutcome", () => {
  it("keeps a refused 4xx so the post can be edited", async () => {
    const refused = new ComposioApiError(400, undefined, "text too long");
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw refused;
      }),
    ).rejects.toBe(refused);
  });

  it("keeps a rate limit so the scheduler can retry", async () => {
    const limited = new ComposioToolError({
      message: "X rejected the post",
      providerStatus: 429,
      providerMessage: "rate limited",
    });
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw limited;
      }),
    ).rejects.toBe(limited);
  });

  it("treats a timeout as unknown so a retry does not double-post", async () => {
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw new ComposioToolError({
          message: "X rejected the post",
          providerMessage: "request timed out",
        });
      }),
    ).rejects.toBeInstanceOf(ComposioPublishOutcomeUnknownError);
  });

  it("treats a 500 as unknown so a retry does not double-post", async () => {
    await expect(
      guardSocialCreateOutcome("YouTube", async () => {
        throw new ComposioApiError(500, undefined, "upstream");
      }),
    ).rejects.toMatchObject({
      name: "ComposioPublishOutcomeUnknownError",
      message: expect.stringContaining("YouTube"),
    });
  });
});
