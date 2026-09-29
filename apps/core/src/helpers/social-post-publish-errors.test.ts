import { describe, expect, it } from "vitest";

import { ComposioApiError, ComposioToolError } from "@/clients/composio.client";

import { classifyPublishError } from "./social-post-publish-errors";

describe("classifyPublishError", () => {
  it.each([
    [
      "Composio 429",
      new ComposioApiError(429, undefined, "publish X post failed (429)"),
      { kind: "rate_limited", transient: true },
    ],
    [
      "Composio 500",
      new ComposioApiError(500, undefined, "publish X post failed (500)"),
      { kind: "provider_unavailable", transient: true },
    ],
    [
      "Composio 502",
      new ComposioApiError(502, undefined, "publish X post failed (502)"),
      { kind: "provider_unavailable", transient: true },
    ],
    [
      "Composio timeout",
      new ComposioApiError(503, undefined, "Composio API timed out"),
      { kind: "timeout", transient: true },
    ],
    [
      "Composio 503",
      new ComposioApiError(503, undefined, "publish X post failed (503)"),
      { kind: "provider_unavailable", transient: true },
    ],
    [
      "Composio 401",
      new ComposioApiError(401, undefined, "publish X post failed (401)"),
      { kind: "unauthorized", transient: false },
    ],
    [
      "Composio 403",
      new ComposioApiError(403, undefined, "publish X post failed (403)"),
      { kind: "unauthorized", transient: false },
    ],
    [
      "Composio 400",
      new ComposioApiError(400, undefined, "publish X post failed (400)"),
      { kind: "rejected", transient: false },
    ],
    [
      "tool rate limit",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Too Many Requests: rate limit exceeded",
        providerStatus: 429,
      }),
      { kind: "rate_limited", transient: true },
    ],
    [
      "tool 429 status",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Request failed with status 429",
      }),
      { kind: "rate_limited", transient: true },
    ],
    [
      "tool 503",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Service unavailable (503)",
      }),
      { kind: "provider_unavailable", transient: true },
    ],
    [
      "tool temporarily",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "The service is temporarily unavailable",
      }),
      { kind: "provider_unavailable", transient: true },
    ],
    [
      "tool timeout",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Upstream request timeout",
      }),
      { kind: "timeout", transient: true },
    ],
    [
      "tool rejected",
      new ComposioToolError({
        message: "X publish failed",
        providerMessage:
          "You are not allowed to create a Tweet with duplicate content.",
        providerStatus: 403,
      }),
      { kind: "rejected", transient: false },
    ],
    [
      "tool without provider message",
      new ComposioToolError({ message: "X publish returned no post id" }),
      { kind: "rejected", transient: false },
    ],
    [
      "unknown error",
      new TypeError("fetch failed"),
      { kind: "unknown", transient: true },
    ],
    ["non-error value", "boom", { kind: "unknown", transient: true }],
  ])("classifies %s", (_name, error, expected) => {
    expect(classifyPublishError(error)).toMatchObject(expected);
  });

  it("summarizes a tool error with the provider status and message", () => {
    const result = classifyPublishError(
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Duplicate content",
        providerStatus: 403,
      }),
    );

    expect(result.summary).toBe("X rejected the post (403): Duplicate content");
  });

  it("summarizes a Composio API error by its message", () => {
    const result = classifyPublishError(
      new ComposioApiError(429, undefined, "publish X post failed (429)"),
    );

    expect(result.summary).toBe("publish X post failed (429)");
  });

  it("keeps the summary short and free of newlines", () => {
    const result = classifyPublishError(
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: `line one\n${"x".repeat(400)}`,
      }),
    );

    expect(result.summary).not.toContain("\n");
    expect(result.summary.length).toBeLessThanOrEqual(300);
  });

  it("falls back to a generic summary for unknown errors", () => {
    expect(classifyPublishError(new Error("")).summary).toBe(
      "Unexpected error while publishing",
    );
    expect(classifyPublishError(null).summary).toBe(
      "Unexpected error while publishing",
    );
  });
});
