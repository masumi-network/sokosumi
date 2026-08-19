import { describe, expect, it, vi } from "vitest";

import {
  EveHttpSokoBotRuntime,
  EveRuntimeError,
} from "../../core/src/lib/soko-bot/eve-http-runtime";

const TURN_INPUT = {
  userId: "user_1",
  sokoBotId: "01960001-0001-7001-8001-000000000001",
  workspaceId: "01960001-0001-7001-8001-000000000002",
  sessionId: null,
  turnId: "turn_1",
  message: "Plan launch",
  requestToken: "request-token",
  turnGrant: "turn-grant",
};

function requestFrom(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [input, init] = fetchMock.mock.calls[index] ?? [];
  return {
    url: new URL(String(input)),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
  };
}

function ndjsonResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

describe("EveHttpSokoBotRuntime channel contract", () => {
  it("creates idempotent sessions with scoped auth headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: "session_1" }), {
        status: 200,
      }),
    );
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-0.38.3",
      fetchMock,
    );

    await expect(runtime.createSession(TURN_INPUT)).resolves.toMatchObject({
      sessionId: "session_1",
      runtimeVersion: "eve-0.38.3",
    });
    const create = requestFrom(fetchMock, 0);
    expect(create.url.pathname).toBe("/eve/v1/session");
    expect(create.method).toBe("POST");
    expect(create.headers.get("authorization")).toBe("Bearer request-token");
    expect(create.headers.get("x-soko-bot-turn-grant")).toBe("turn-grant");
    expect(create.body).toEqual({
      message: "Plan launch",
      operationId: "turn_1",
    });
  });

  it("parses split NDJSON and advances indexes from requested cursor", async () => {
    const first = JSON.stringify({
      type: "turn.started",
      data: {},
      meta: { id: "event_1", at: "2026-08-18T12:00:00.000Z" },
    });
    const second = JSON.stringify({
      type: "session.waiting",
      data: {},
      meta: { id: "event_2", at: "2026-08-18T12:00:01.000Z" },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        ndjsonResponse([
          `${first.slice(0, 20)}`,
          `${first.slice(20)}\n${second}`,
        ]),
      );
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-0.38.3",
      fetchMock,
    );

    const events = [];
    for await (const event of runtime.streamEvents({
      sessionId: "session/with spaces",
      requestToken: "request-token",
      startIndex: 7,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { startIndex: 7, event: JSON.parse(first) },
      { startIndex: 8, event: JSON.parse(second) },
    ]);
    const stream = requestFrom(fetchMock, 0);
    expect(stream.url.pathname).toBe(
      "/eve/v1/session/session%2Fwith%20spaces/stream",
    );
    expect(stream.url.searchParams.get("startIndex")).toBe("7");
    expect(stream.method).toBe("GET");
    expect(stream.headers.get("authorization")).toBe("Bearer request-token");
    expect(stream.headers.has("x-soko-bot-turn-grant")).toBe(false);
  });

  it("sends cancel and reset controls without exposing turn grants", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-0.38.3",
      fetchMock,
    );

    await runtime.cancelTurn({
      sessionId: "session_1",
      eveTurnId: "turn_1",
      requestToken: "request-token",
    });
    await runtime.resetSession({
      sessionId: "session_1",
      reason: "Operator reset",
      requestToken: "request-token",
    });

    const cancel = requestFrom(fetchMock, 0);
    expect(cancel.url.pathname).toBe("/eve/v1/session/session_1/cancel");
    expect(cancel.body).toEqual({ turnId: "turn_1" });
    expect(cancel.headers.get("authorization")).toBe("Bearer request-token");
    expect(cancel.headers.has("x-soko-bot-turn-grant")).toBe(false);

    const reset = requestFrom(fetchMock, 1);
    expect(reset.url.pathname).toBe("/eve/v1/session/session_1/reset");
    expect(reset.body).toEqual({ reason: "Operator reset" });
    expect(reset.headers.get("authorization")).toBe("Bearer request-token");
    expect(reset.headers.has("x-soko-bot-turn-grant")).toBe(false);
  });

  it("surfaces bounded non-2xx response details for JSON and stream calls", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("runtime unavailable", { status: 503 }),
      )
      .mockResolvedValueOnce(new Response("stream denied", { status: 401 }));
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-0.38.3",
      fetchMock,
    );

    const resetError = await runtime
      .resetSession({
        sessionId: "session_1",
        reason: "Retry",
        requestToken: "request-token",
      })
      .catch((error: unknown) => error);
    expect(resetError).toBeInstanceOf(EveRuntimeError);
    expect(resetError).toMatchObject({
      status: 503,
      body: "runtime unavailable",
    });

    const consumeStream = async () => {
      for await (const _event of runtime.streamEvents({
        sessionId: "session_1",
        requestToken: "request-token",
        startIndex: 0,
      })) {
        // Consume stream so request errors surface.
      }
    };
    await expect(consumeStream()).rejects.toMatchObject({
      status: 401,
      body: "stream denied",
    });
  });

  it("rejects malformed success payloads at the Eve boundary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "accepted" }), { status: 200 }),
      );
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-0.38.3",
      fetchMock,
    );

    await expect(runtime.createSession(TURN_INPUT)).rejects.toMatchObject({
      name: "EveRuntimeError",
      status: 502,
      message: "Eve runtime returned an invalid success payload",
    });
  });
});
