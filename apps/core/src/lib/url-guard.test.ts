import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { httpsRequestMock, useAgentMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  useAgentMock: vi.fn(),
}));

vi.mock("node:https", () => ({ default: { request: httpsRequestMock } }));
vi.mock("node:http", () => ({ default: { request: vi.fn() } }));
vi.mock("request-filtering-agent", () => ({ useAgent: useAgentMock }));

import {
  assertPublicHttpUrl,
  MAX_SSRF_FETCH_REDIRECTS,
  SsrfError,
  ssrfSafeFetch,
} from "./url-guard";

const SENTINEL_AGENT = { sentinel: true };

interface MockResponseSpec {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Builds an http(s).request stub that emits a single response. */
function mockRequestImplementation(spec: MockResponseSpec) {
  return (
    _url: URL,
    _options: unknown,
    callback: (message: EventEmitter) => void,
  ) => {
    const message = Object.assign(new EventEmitter(), {
      statusCode: spec.status,
      statusMessage: "",
      headers: spec.headers ?? {},
    });
    const request = Object.assign(new EventEmitter(), {
      end: () => {
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
  it("returns the parsed URL for a well-formed http(s) URL", () => {
    expect(assertPublicHttpUrl("https://example.com/file.pdf").href).toBe(
      "https://example.com/file.pdf",
    );
    expect(assertPublicHttpUrl("http://example.com/").href).toBe(
      "http://example.com/",
    );
  });

  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
    "gopher://x",
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

  it("returns the response and routes through the filtering agent", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({ status: 200, body: "ok" }),
    );

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    // The connection is filtered by request-filtering-agent for this exact URL.
    expect(useAgentMock).toHaveBeenCalledWith("https://example.com/file.pdf");
    expect(httpsRequestMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      agent: SENTINEL_AGENT,
    });
  });

  it("follows a redirect and re-applies the agent to the new host", async () => {
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
    expect(String(httpsRequestMock.mock.calls[1]?.[0])).toBe(
      "https://cdn.example.com/file.pdf",
    );
    // Agent re-derived per hop so the redirect target is filtered too.
    expect(useAgentMock).toHaveBeenCalledWith(
      "https://cdn.example.com/file.pdf",
    );
  });

  it("throws once the redirect limit is exceeded", async () => {
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
