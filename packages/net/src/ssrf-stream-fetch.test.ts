import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { httpRequest, httpsRequest, useAgent } = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
  useAgent: vi.fn(),
}));
vi.mock("node:http", () => ({ default: { request: httpRequest } }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));
vi.mock("request-filtering-agent", () => ({ useAgent }));

import { SsrfError, ssrfSafeStreamFetch } from "./ssrf-fetch.js";

const FILTERING_AGENT = { filtering: true };
const URL = "https://coworker.example/responses";
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface RequestOptions {
  method: string;
  headers: Record<string, string>;
  agent: object;
  signal?: AbortSignal;
}

function fixture(
  options: {
    status?: number;
    headers?: Record<string, string>;
    source?: Readable;
    beforeHeadersError?: Error;
  } = {},
) {
  const message = Object.assign(options.source ?? new PassThrough(), {
    statusCode: options.status ?? 200,
    statusMessage: "",
    headers: options.headers ?? { "content-type": "text/event-stream" },
  });
  const request = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn((error?: Error) => {
      message.destroy(error);
      if (error) request.emit("error", error);
      return request;
    }),
  });
  const implementation = (
    _url: globalThis.URL,
    init: RequestOptions,
    callback: (response: typeof message) => void,
  ) => {
    // Model native request abort behavior, including after headers arrive.
    init.signal?.addEventListener(
      "abort",
      () => {
        const error = new Error("Request aborted");
        request.emit("error", error);
        message.destroy(error);
      },
      { once: true },
    );
    request.end.mockImplementation(() => {
      queueMicrotask(() => {
        if (options.beforeHeadersError) {
          request.emit("error", options.beforeHeadersError);
        } else {
          callback(message);
        }
      });
    });
    return request;
  };
  httpsRequest.mockImplementation(implementation);
  httpRequest.mockImplementation(implementation);
  return { message, request };
}

describe("SSRF invariant: coworker response streams use filtered connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgent.mockReturnValue(FILTERING_AGENT);
  });

  it("returns headers and the first SSE event before the upstream finishes", async () => {
    const { message } = fixture();
    const pending = ssrfSafeStreamFetch(URL, { maxResponseBytes: 1024 });
    try {
      expect(
        await Promise.race([
          pending.then(() => true),
          turn().then(() => false),
        ]),
      ).toBe(true);
      const response = await pending;
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      message.push(Buffer.from("data: first\n\n"));
      const event = await reader.read();
      expect(new TextDecoder().decode(event.value)).toBe("data: first\n\n");
      expect(message.readableEnded).toBe(false);
      await reader.cancel();
    } finally {
      message.destroy();
    }
  });

  it("does not drain an unread upstream response without bound", async () => {
    const chunkCount = 64;
    let produced = 0;
    const source = new Readable({
      highWaterMark: 1,
      read() {
        produced += 1;
        this.push(produced <= chunkCount ? Buffer.alloc(1024) : null);
      },
    });
    const { message } = fixture({ source });
    const response = await ssrfSafeStreamFetch(URL, {
      maxResponseBytes: 128 * 1024,
    });
    await turn();
    expect(produced).toBeLessThan(chunkCount);
    await response.body!.cancel();
    await turn();
    expect(message.destroyed).toBe(true);
  });

  it.each(["gzip", "br", "deflate", "gzip, br"])(
    "rejects unexpected compressed %s responses before exposing SSE",
    async (encoding) => {
      const { message } = fixture({
        headers: { "content-encoding": encoding },
      });
      await expect(
        ssrfSafeStreamFetch(URL, { maxResponseBytes: 1024 }),
      ).rejects.toThrow("Response must use identity Content-Encoding");
      expect(message.destroyed).toBe(true);
    },
  );

  it.each(["http://coworker.example/responses", URL])(
    "sends bytes through the filtering agent for %s",
    async (url) => {
      const { message, request } = fixture();
      const signal = new AbortController().signal;
      const response = await ssrfSafeStreamFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"input":"hello"}',
        signal,
        maxResponseBytes: 1024,
      });
      const mock = url.startsWith("https:") ? httpsRequest : httpRequest;
      expect(mock.mock.calls[0][1]).toMatchObject({
        method: "POST",
        signal,
        agent: FILTERING_AGENT,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "17",
          "Accept-Encoding": "identity",
        },
      });
      expect(useAgent).toHaveBeenCalledWith(url);
      expect(request.write).toHaveBeenCalledWith('{"input":"hello"}');
      await response.body!.cancel();
      expect(message.destroyed).toBe(true);
    },
  );

  it.each(["POST", "GET"])(
    "never follows a %s redirect to an internal host",
    async (method) => {
      fixture({
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      });
      const response = await ssrfSafeStreamFetch(URL, {
        method,
        maxResponseBytes: 1024,
      });
      expect(response.status).toBe(302);
      expect(httpsRequest).toHaveBeenCalledOnce();
      expect(httpRequest).not.toHaveBeenCalled();
      await response.body!.cancel();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "rejects invalid byte limit %s before opening a connection",
    async (maxResponseBytes) => {
      await expect(
        ssrfSafeStreamFetch(URL, { maxResponseBytes }),
      ).rejects.toBeInstanceOf(SsrfError);
      expect(httpsRequest).not.toHaveBeenCalled();
    },
  );

  it.each(["file:///etc/passwd", "ftp://coworker.example", "invalid"])(
    "rejects invalid HTTP destination %s before opening a connection",
    async (url) => {
      await expect(
        ssrfSafeStreamFetch(url, { maxResponseBytes: 1024 }),
      ).rejects.toBeInstanceOf(SsrfError);
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(httpRequest).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized declared body and closes its source", async () => {
    const { message } = fixture({ headers: { "content-length": "100" } });
    await expect(
      ssrfSafeStreamFetch(URL, { maxResponseBytes: 50 }),
    ).rejects.toThrow(/Content-Length/);
    expect(message.destroyed).toBe(true);
  });

  it("rejects chunked overflow during reading and closes its source", async () => {
    const { message } = fixture();
    const response = await ssrfSafeStreamFetch(URL, { maxResponseBytes: 3 });
    const reader = response.body!.getReader();
    message.push(Buffer.from("abc"));
    expect((await reader.read()).value).toEqual(
      new Uint8Array(Buffer.from("abc")),
    );
    const next = reader.read();
    const rejection = expect(next).rejects.toThrow(/maxResponseBytes|exceeds/);
    message.push(Buffer.from("d"));
    await rejection;
    expect(message.destroyed).toBe(true);
  });

  it("propagates a shared byte-budget failure to the reader", async () => {
    const { message } = fixture();
    const response = await ssrfSafeStreamFetch(URL, {
      maxResponseBytes: 1024,
      onResponseBytes: () => {
        throw new Error("Shared budget exhausted");
      },
    });
    const rejection = expect(response.text()).rejects.toThrow(
      "Shared budget exhausted",
    );
    message.push(Buffer.from("event"));
    await rejection;
    expect(message.destroyed).toBe(true);
  });

  it("rejects request errors before response headers", async () => {
    fixture({ beforeHeadersError: new Error("Connection refused") });
    await expect(
      ssrfSafeStreamFetch(URL, { maxResponseBytes: 1024 }),
    ).rejects.toThrow("Connection refused");
  });

  it("rejects body reads when the upstream fails after response headers", async () => {
    const { message } = fixture();
    const response = await ssrfSafeStreamFetch(URL, { maxResponseBytes: 1024 });
    const rejection = expect(response.text()).rejects.toThrow(
      "Upstream closed",
    );
    message.destroy(new Error("Upstream closed"));
    await rejection;
  });

  it("rejects body reads when the request fails after response headers", async () => {
    const { request, message } = fixture();
    const response = await ssrfSafeStreamFetch(URL, { maxResponseBytes: 1024 });
    const rejection = expect(response.text()).rejects.toThrow("Socket failed");
    request.emit("error", new Error("Socket failed"));
    await rejection;
    expect(message.destroyed).toBe(true);
  });

  it("aborts a live response and closes the upstream source", async () => {
    const { message } = fixture();
    const controller = new AbortController();
    const response = await ssrfSafeStreamFetch(URL, {
      signal: controller.signal,
      maxResponseBytes: 1024,
    });
    const rejection = expect(response.text()).rejects.toThrow(/abort/i);
    controller.abort();
    await rejection;
    expect(message.destroyed).toBe(true);
  });
});
