import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { httpsRequestMock, httpRequestMock, useAgentMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  httpRequestMock: vi.fn(),
  useAgentMock: vi.fn(),
}));

vi.mock("node:https", () => ({ default: { request: httpsRequestMock } }));
vi.mock("node:http", () => ({ default: { request: httpRequestMock } }));
vi.mock("request-filtering-agent", () => ({ useAgent: useAgentMock }));

import {
  assertPublicHttpUrl,
  MAX_SSRF_FETCH_REDIRECTS,
  SsrfError,
  ssrfSafeFetch,
} from "./ssrf-fetch.js";

const SENTINEL_AGENT = { sentinel: true };

interface MockResponseSpec {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

interface CapturedRequest {
  url: URL;
  options: { method?: string; headers?: Record<string, string> };
  body: string | undefined;
}

/** Builds an http(s).request stub that emits a single response and records the request. */
function mockRequestImplementation(
  spec: MockResponseSpec,
  captured?: CapturedRequest[],
) {
  return (
    url: URL,
    options: { method?: string; headers?: Record<string, string> },
    callback: (message: EventEmitter) => void,
  ) => {
    let body: string | undefined;
    const message = Object.assign(new EventEmitter(), {
      statusCode: spec.status,
      statusMessage: "",
      headers: spec.headers ?? {},
    });
    const request = Object.assign(new EventEmitter(), {
      write: (chunk: string) => {
        body = chunk;
      },
      end: () => {
        captured?.push({ url, options, body });
        queueMicrotask(() => {
          if (spec.body) {
            message.emit("data", Buffer.from(spec.body));
          }
          message.emit("end");
        });
      },
    });
    callback(message);
    return request;
  };
}

describe("assertPublicHttpUrl", () => {
  it("returns the parsed URL for a well-formed http(s) URL or URL object", () => {
    expect(assertPublicHttpUrl("https://example.com/x").href).toBe(
      "https://example.com/x",
    );
    expect(assertPublicHttpUrl(new URL("http://example.com/")).href).toBe(
      "http://example.com/",
    );
  });

  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
  ])("rejects non-http(s) scheme %s", (raw) => {
    expect(() => assertPublicHttpUrl(raw)).toThrow(SsrfError);
  });

  it("rejects a malformed URL", () => {
    expect(() => assertPublicHttpUrl("not a url")).toThrow(SsrfError);
  });
});

describe("ssrfSafeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentMock.mockReturnValue(SENTINEL_AGENT);
  });

  it("performs a GET through the filtering agent and returns the response", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({ status: 200, body: "ok" }),
    );

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(useAgentMock).toHaveBeenCalledWith("https://example.com/file.pdf");
    expect(httpsRequestMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      agent: SENTINEL_AGENT,
    });
  });

  it("sends method, headers, body and a derived Content-Length for POST", async () => {
    const captured: CapturedRequest[] = [];
    const body = JSON.stringify({ hello: "world" });
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({ status: 200, body: "{}" }, captured),
    );

    await ssrfSafeFetch("https://example.com/start_job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].options.method).toBe("POST");
    expect(captured[0].body).toBe(body);
    expect(captured[0].options.headers).toMatchObject({
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    });
  });

  it("follows a GET redirect and re-applies the agent to the new host", async () => {
    httpsRequestMock
      .mockImplementationOnce(
        mockRequestImplementation({
          status: 302,
          headers: { location: "https://cdn.example.com/file.pdf" },
        }),
      )
      .mockImplementationOnce(
        mockRequestImplementation({ status: 200, body: "ok" }),
      );

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
    expect(useAgentMock).toHaveBeenCalledWith(
      "https://cdn.example.com/file.pdf",
    );
  });

  it("does NOT follow redirects for non-GET methods", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({
        status: 302,
        headers: { location: "https://cdn.example.com/x" },
      }),
    );

    const response = await ssrfSafeFetch("https://example.com/start_job", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(302);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("throws once the GET redirect limit is exceeded", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({
        status: 302,
        headers: { location: "https://example.com/loop" },
      }),
    );

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(httpsRequestMock).toHaveBeenCalledTimes(
      MAX_SSRF_FETCH_REDIRECTS + 1,
    );
  });
});
