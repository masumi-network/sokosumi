import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWebhookFailureContext,
  MAX_REPORTED_WEBHOOK_BODY_LENGTH,
  postWebhook,
} from "./webhook";

const OPTS = { userAgent: "Test-Agent/1.0" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("postWebhook", () => {
  it("returns ok for a 2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("done", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await postWebhook("https://example.test", { a: 1 }, OPTS);

    expect(result).toEqual({ status: "ok", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "Test-Agent/1.0",
        }),
        body: JSON.stringify({ a: 1 }),
      }),
    );
  });

  it("classifies queue-full backpressure separately from failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("The request queue reached full capacity.", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postWebhook("https://example.test", {}, OPTS);

    expect(result.status).toBe("backpressure");
  });

  it("returns failed with response detail for a non-ok, non-backpressure response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("kaboom", {
        status: 500,
        statusText: "Server Error",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postWebhook("https://example.test", {}, OPTS);

    expect(result).toMatchObject({
      status: "failed",
      httpStatus: 500,
      statusText: "Server Error",
      body: "kaboom",
    });
  });

  it("returns failed with a timeout error when aborted", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const abortError = new Error("aborted");
      abortError.name = "AbortError";
      return Promise.reject(abortError);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postWebhook(
      "https://example.test",
      {},
      { ...OPTS, timeoutMs: 5 },
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.message).toContain("timed out");
    }
  });
});

describe("buildWebhookFailureContext", () => {
  it("merges base fields and the error message", () => {
    const context = buildWebhookFailureContext(
      { status: "failed", error: new Error("boom") },
      { webhookType: "agentHired", webhookUrl: "https://example.test" },
    );

    expect(context).toEqual({
      webhookType: "agentHired",
      webhookUrl: "https://example.test",
      error: "boom",
    });
  });

  it("includes response detail and truncates long bodies", () => {
    const longBody = "x".repeat(MAX_REPORTED_WEBHOOK_BODY_LENGTH + 50);
    const context = buildWebhookFailureContext({
      status: "failed",
      error: new Error("boom"),
      httpStatus: 500,
      statusText: "Server Error",
      body: longBody,
    });

    expect(context.responseStatus).toBe(500);
    expect(context.responseStatusText).toBe("Server Error");
    expect(context.responseBody).toBe(
      `${"x".repeat(MAX_REPORTED_WEBHOOK_BODY_LENGTH)}... (truncated)`,
    );
  });

  it("omits response detail when there is no HTTP response", () => {
    const context = buildWebhookFailureContext({
      status: "failed",
      error: new Error("network down"),
    });

    expect(context).not.toHaveProperty("responseStatus");
    expect(context).not.toHaveProperty("responseBody");
  });
});
