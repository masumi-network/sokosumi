import { describe, expect, it } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

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
    expect(classifyPublishError(error, "x")).toMatchObject(expected);
  });

  it.each([401, 403])(
    "classifies X media-upload %s as unauthorized",
    (status) => {
      for (const message of [
        "X refused the image upload",
        "X refused the media upload",
        "X refused the media status check",
      ]) {
        expect(
          classifyPublishError(
            new ComposioToolError({ message, providerStatus: status }),
            "x",
          ),
        ).toMatchObject({ kind: "unauthorized", transient: false });
      }
    },
  );

  it.each([401, 403])(
    "recognizes X upload %s in a tool's text error",
    (status) => {
      expect(
        classifyPublishError(
          new ComposioToolError({
            message: "X refused the image upload",
            providerMessage: `${status} Client Error`,
          }),
          "x",
        ),
      ).toMatchObject({ kind: "unauthorized", transient: false });
    },
  );

  it("keeps X media-upload 400 failures out of unauthorized classification", () => {
    expect(
      classifyPublishError(
        new ComposioToolError({
          message: "upload X image failed (400)",
          providerStatus: 400,
          providerMessage: "Invalid image",
        }),
        "x",
      ),
    ).toMatchObject({ kind: "rejected", transient: false });
  });

  it("keeps a non-authentication 403 rejection from another provider", () => {
    expect(
      classifyPublishError(
        new ComposioToolError({
          message: "YouTube refused the upload",
          providerMessage: "quotaExceeded",
          providerStatus: 403,
        }),
        "youtube",
      ),
    ).toMatchObject({ kind: "rejected", transient: false });
  });

  it("recognizes missing publishing permission without a status", () => {
    expect(
      classifyPublishError(
        new ComposioToolError({
          message: "X refused the post",
          providerMessage: "Missing permission to publish",
        }),
        "x",
      ),
    ).toMatchObject({ kind: "unauthorized", transient: false });
  });

  it("summarizes a tool error with the provider status and message", () => {
    const result = classifyPublishError(
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: "Duplicate content",
        providerStatus: 403,
      }),
      "x",
    );

    expect(result.summary).toBe("X rejected the post (403): Duplicate content");
  });

  it("summarizes a Composio API error by its message", () => {
    const result = classifyPublishError(
      new ComposioApiError(429, undefined, "publish X post failed (429)"),
      "x",
    );

    expect(result.summary).toBe("publish X post failed (429)");
  });

  it("keeps the summary short and free of newlines", () => {
    const result = classifyPublishError(
      new ComposioToolError({
        message: "X publish failed",
        providerMessage: `line one\n${"x".repeat(400)}`,
      }),
      "x",
    );

    expect(result.summary).not.toContain("\n");
    expect(result.summary.length).toBeLessThanOrEqual(300);
  });

  it("falls back to a generic summary for unknown errors", () => {
    expect(classifyPublishError(new Error(""), "x").summary).toBe(
      "Unexpected error while publishing",
    );
    expect(classifyPublishError(null, "x").summary).toBe(
      "Unexpected error while publishing",
    );
  });
});
