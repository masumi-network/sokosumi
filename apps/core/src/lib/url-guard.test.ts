import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, httpsRequestMock, httpRequestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  httpsRequestMock: vi.fn(),
  httpRequestMock: vi.fn(),
}));

vi.mock("node:dns", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ default: { request: httpsRequestMock } }));
vi.mock("node:http", () => ({ default: { request: httpRequestMock } }));

import {
  assertPublicHttpUrl,
  guardedLookup,
  isDisallowedIp,
  MAX_SSRF_FETCH_REDIRECTS,
  SsrfError,
  ssrfSafeFetch,
} from "./url-guard";

interface LookupResult {
  address: string;
  family: number;
}

/** Make `dns.lookup` resolve any host to the given addresses. */
function resolvesTo(...addresses: string[]): void {
  lookupMock.mockImplementation(
    (
      _host: string,
      _options: unknown,
      callback: (err: Error | null, addrs: LookupResult[]) => void,
    ) => {
      callback(
        null,
        addresses.map((address) => ({
          address,
          family: address.includes(":") ? 6 : 4,
        })),
      );
    },
  );
}

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

describe("isDisallowedIp", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata endpoint
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "0:0:0:0:0:0:0:1", // non-canonical loopback
    "::",
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "fd12:3456::1", // unique-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback (dotted)
    "::ffff:7f00:1", // IPv4-mapped loopback (hex)
    "::ffff:169.254.169.254", // IPv4-mapped metadata
  ])("rejects non-public address %s", (ip) => {
    expect(isDisallowedIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just outside 172.16/12
    "172.15.255.255",
    "100.63.255.255", // just outside CGNAT
    "100.128.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111", // public IPv6
    "::ffff:8.8.8.8", // IPv4-mapped public
  ])("allows public address %s", (ip) => {
    expect(isDisallowedIp(ip)).toBe(false);
  });

  it("rejects values that are not valid IP literals", () => {
    expect(isDisallowedIp("not-an-ip")).toBe(true);
    expect(isDisallowedIp("0x7f.0.0.1")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it("returns the parsed URL for a public host without resolving DNS", () => {
    const url = assertPublicHttpUrl("https://example.com/file.pdf");
    expect(url.href).toBe("https://example.com/file.pdf");
    // Hostname resolution is deferred to the pinned connect-time lookup.
    expect(lookupMock).not.toHaveBeenCalled();
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

  it("rejects a private IP-literal host", () => {
    expect(() =>
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/"),
    ).toThrow(SsrfError);
  });

  it("rejects a bracketed IPv6 loopback literal", () => {
    expect(() => assertPublicHttpUrl("http://[::1]/")).toThrow(SsrfError);
  });

  it("rejects a non-canonical IPv6 loopback literal", () => {
    expect(() => assertPublicHttpUrl("http://[0:0:0:0:0:0:0:1]/")).toThrow(
      SsrfError,
    );
  });
});

describe("guardedLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the resolved address for a public host", async () => {
    resolvesTo("93.184.216.34");
    const { address, family } = await new Promise<{
      address: string;
      family: number;
    }>((resolve, reject) => {
      guardedLookup("example.com", {}, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ address: address as string, family: family as number });
      });
    });
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  it("errors when the host resolves to a private address (rebind defense)", async () => {
    resolvesTo("10.0.0.5");
    const error = await new Promise<Error | null>((resolve) => {
      guardedLookup("rebound.example.com", {}, (err) => resolve(err));
    });
    expect(error).toBeInstanceOf(SsrfError);
  });

  it("errors when any resolved address is private", async () => {
    resolvesTo("93.184.216.34", "169.254.169.254");
    const error = await new Promise<Error | null>((resolve) => {
      guardedLookup("mixed.example.com", {}, (err) => resolve(err));
    });
    expect(error).toBeInstanceOf(SsrfError);
  });
});

describe("ssrfSafeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvesTo("93.184.216.34");
  });

  it("returns the response for a non-redirect status", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({ status: 200, body: "ok" }),
    );

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      lookup: guardedLookup,
    });
  });

  it("follows a redirect to another public host", async () => {
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
  });

  it("blocks a redirect that points at an internal IP literal", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({
        status: 302,
        headers: { location: "http://10.0.0.5/secret" },
      }),
    );

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
    // The first hop succeeds; the redirect target is rejected before a second
    // request is issued.
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a metadata IP literal", async () => {
    httpsRequestMock.mockImplementation(
      mockRequestImplementation({
        status: 301,
        headers: { location: "http://169.254.169.254/latest/" },
      }),
    );

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
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
