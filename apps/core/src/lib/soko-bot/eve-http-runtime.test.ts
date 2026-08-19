import { describe, expect, it, vi } from "vitest";

import {
  EVE_CONTROL_MAX_RESPONSE_BYTES,
  EVE_STREAM_MAX_EVENT_BYTES,
  EveHttpSokoBotRuntime,
  EveRuntimeWireError,
} from "./eve-http-runtime";

const TURN_INPUT = {
  userId: "user_1",
  sokoBotId: "bot_1",
  workspaceId: "workspace_1",
  sessionId: null,
  turnId: "turn_1",
  message: "Hello",
  requestToken: "request-token",
  turnGrant: "turn-grant",
};

const INSPECT_INPUT = {
  sessionId: "session_1",
  requestToken: "request-token",
};

function acceptedResponse() {
  return new Response(JSON.stringify({ sessionId: "session_1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("EveHttpSokoBotRuntime", () => {
  it("sends durable Core turn id as Eve create operationId", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => acceptedResponse());
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      fetchMock,
    );

    await runtime.createSession(TURN_INPUT);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      message: "Hello",
      operationId: "turn_1",
    });
  });

  it("bounds every command request with an abort signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => acceptedResponse());
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      fetchMock,
    );

    await runtime.cancelTurn({
      sessionId: "session_1",
      eveTurnId: "eve_turn_1",
      requestToken: "request-token",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects and cancels oversized command success bodies", async () => {
    const cancelMock = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(EVE_CONTROL_MAX_RESPONSE_BYTES + 1));
      },
      cancel: cancelMock,
    });
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      vi.fn<typeof fetch>(async () => new Response(body, { status: 200 })),
    );

    await expect(runtime.createSession(TURN_INPUT)).rejects.toBeInstanceOf(
      EveRuntimeWireError,
    );
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it("rejects and cancels oversized stream error bodies", async () => {
    const cancelMock = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(EVE_CONTROL_MAX_RESPONSE_BYTES + 1));
      },
      cancel: cancelMock,
    });
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      vi.fn<typeof fetch>(async () => new Response(body, { status: 503 })),
    );
    const iterator = runtime
      .streamEvents({
        sessionId: "session_1",
        requestToken: "request-token",
        startIndex: 0,
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBeInstanceOf(EveRuntimeWireError);
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it("rejects and cancels an oversized newline-free event before parsing", async () => {
    const cancelMock = vi.fn();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("x".repeat(EVE_STREAM_MAX_EVENT_BYTES + 1)),
        );
        setTimeout(() => {
          if (!cancelled) controller.close();
        }, 20);
      },
      cancel() {
        cancelled = true;
        cancelMock();
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(body, { status: 200 })),
    );
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      fetchMock,
    );
    const iterator = runtime
      .streamEvents({
        sessionId: "session_1",
        requestToken: "request-token",
        startIndex: 0,
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toBeInstanceOf(EveRuntimeWireError);
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it("immediately cancels an endless health response without awaiting cancellation", async () => {
    const cancelMock = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ cancel: cancelMock });
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      vi.fn<typeof fetch>(async () => new Response(body, { status: 200 })),
    );

    await expect(runtime.inspectSession(INSPECT_INPUT)).resolves.toEqual({
      healthy: true,
      runtimeVersion: "eve-test",
      sessionStatus: null,
    });
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it("cancels an oversized health response instead of retaining its body", async () => {
    const cancelMock = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(EVE_CONTROL_MAX_RESPONSE_BYTES + 1));
      },
      cancel: cancelMock,
    });
    const runtime = new EveHttpSokoBotRuntime(
      "https://eve.example.com",
      "eve-test",
      vi.fn<typeof fetch>(async () => new Response(body, { status: 200 })),
    );

    await runtime.inspectSession(INSPECT_INPUT);

    expect(cancelMock).toHaveBeenCalledOnce();
  });
});
