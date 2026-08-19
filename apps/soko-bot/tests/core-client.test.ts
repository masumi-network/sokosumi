import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn().mockResolvedValue("oidc-token"),
}));

import { CORE_MAX_RESPONSE_BYTES, callCore } from "../agent/lib/core";

const AUTH = {
  userId: "user_1",
  sokoBotId: "bot_1",
  workspaceId: "workspace_1",
  turnId: "turn_1",
  sessionIdClaim: "session_1",
  turnGrant: "turn-grant",
  capabilities: [],
};

function streamedResponse(
  chunks: Uint8Array[],
  options: { cancel?: () => void; close?: boolean; status?: number } = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (options.close !== false) controller.close();
      },
      cancel: options.cancel,
    }),
    { status: options.status ?? 200 },
  );
}

function responseWithReaderCancellationSpy(body: string, status = 200) {
  const response = streamedResponse([new TextEncoder().encode(body)], {
    status,
  });
  const stream = response.body;
  if (!stream) throw new Error("Expected test response body");
  const reader = stream.getReader();
  const cancel = vi.spyOn(reader, "cancel");
  vi.spyOn(stream, "getReader").mockReturnValue(reader);
  return { cancel, response };
}

describe("Soko Bot Core client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.SOKO_BOT_CORE_BASE_URL = "https://core.example.com";
    delete process.env.EVE_EVALUATION;
  });

  it("always applies a request deadline and combines caller cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await callCore(
      "/v1/internal/soko-bot/context",
      AUTH,
      "session_1",
      {},
      { parse: (value) => value },
      controller.signal,
    );

    const signal = fetchMock.mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("parses a bounded success response split inside a multibyte character", async () => {
    const encoder = new TextEncoder();
    const prefix = '{"data":{"value":"';
    const suffix = '"}}';
    const multibyteValue = "💡";
    const paddingBytes =
      CORE_MAX_RESPONSE_BYTES -
      encoder.encode(prefix).byteLength -
      encoder.encode(suffix).byteLength -
      encoder.encode(multibyteValue).byteLength;
    const bytes = encoder.encode(
      `${prefix}${"a".repeat(paddingBytes)}${multibyteValue}${suffix}`,
    );
    const multibyteStart = encoder.encode(prefix).byteLength + paddingBytes;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamedResponse([
            bytes.slice(0, multibyteStart + 2),
            bytes.slice(multibyteStart + 2),
          ]),
        ),
    );

    const result = await callCore(
      "/v1/internal/soko-bot/context",
      AUTH,
      "session_1",
      {},
      { parse: (value) => value as { value: string } },
    );

    expect(bytes.byteLength).toBe(CORE_MAX_RESPONSE_BYTES);
    expect(result.value).toHaveLength(paddingBytes + 2);
    expect(result.value.endsWith(multibyteValue)).toBe(true);
  });

  it.each([
    ["success", 200],
    ["error", 503],
  ])(
    "rejects and cancels an oversized newline-free %s response",
    async (_kind, status) => {
      const cancelMock = vi.fn();
      const secretMarker = "must-not-leak";
      const bytes = new TextEncoder().encode(
        `${secretMarker}${"x".repeat(CORE_MAX_RESPONSE_BYTES)}`,
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          streamedResponse([bytes], {
            cancel: cancelMock,
            close: false,
            status,
          }),
        ),
      );

      const request = callCore(
        "/v1/internal/soko-bot/context",
        AUTH,
        "session_1",
        {},
        { parse: (value) => value },
      );

      await expect(request).rejects.toThrow(
        status === 200
          ? "Core response exceeded byte limit"
          : `Core returned ${status}`,
      );
      await expect(request).rejects.not.toThrow(secretMarker);
      expect(cancelMock).toHaveBeenCalledOnce();
    },
  );

  it("cancels a malformed success response and returns a stable error", async () => {
    const { cancel, response } = responseWithReaderCancellationSpy(
      "not-json-and-must-not-be-reflected",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const request = callCore(
      "/v1/internal/soko-bot/context",
      AUTH,
      "session_1",
      {},
      { parse: (value) => value },
    );

    await expect(request).rejects.toThrow(
      "Core returned invalid Soko Bot response",
    );
    await expect(request).rejects.not.toThrow("must-not-be-reflected");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a non-success response without reading or reflecting its body", async () => {
    const cancelMock = vi.fn();
    const response = streamedResponse(
      [new TextEncoder().encode('{"error":"Access denied"}')],
      {
        cancel: cancelMock,
        close: false,
        status: 403,
      },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const request = callCore(
      "/v1/internal/soko-bot/context",
      AUTH,
      "session_1",
      {},
      { parse: (value) => value },
    );

    await expect(request).rejects.toThrow("Core returned 403");
    await expect(request).rejects.not.toThrow("Access denied");
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it("cancels the response when schema parsing rejects its data", async () => {
    const { cancel, response } = responseWithReaderCancellationSpy(
      JSON.stringify({ data: { ok: false } }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const schemaError = new Error("Schema rejected Core data");

    const request = callCore(
      "/v1/internal/soko-bot/context",
      AUTH,
      "session_1",
      {},
      {
        parse() {
          throw schemaError;
        },
      },
    );

    await expect(request).rejects.toBe(schemaError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
