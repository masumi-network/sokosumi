import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  assertPublicHttpUrl,
  isDisallowedIp,
  MAX_SSRF_FETCH_REDIRECTS,
  SsrfError,
  ssrfSafeFetch,
} from "./url-guard";

const originalFetch = global.fetch;

function resolvesTo(...addresses: string[]): void {
  lookupMock.mockResolvedValue(addresses.map((address) => ({ address })));
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
    "::",
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "fd12:3456::1", // unique-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback
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
  beforeEach(() => {
    vi.clearAllMocks();
    resolvesTo("93.184.216.34");
  });

  it("returns the parsed URL for a public host", async () => {
    const url = await assertPublicHttpUrl("https://example.com/file.pdf");
    expect(url.href).toBe("https://example.com/file.pdf");
  });

  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
    "gopher://x",
  ])("rejects non-http(s) scheme %s", async (raw) => {
    await expect(assertPublicHttpUrl(raw)).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it("rejects an IP-literal host that is private without DNS lookup", async () => {
    await expect(
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a bracketed IPv6 loopback literal", async () => {
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it("rejects when the host resolves to a private address", async () => {
    resolvesTo("10.0.0.5");
    await expect(
      assertPublicHttpUrl("https://internal.example.com/"),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects when ANY resolved address is private", async () => {
    resolvesTo("93.184.216.34", "127.0.0.1");
    await expect(
      assertPublicHttpUrl("https://rebind.example.com/"),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects when DNS resolution fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertPublicHttpUrl("https://nope.example.com/"),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("ssrfSafeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvesTo("93.184.216.34");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the response for a non-redirect status", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("ok", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to another public host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/file.pdf" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await ssrfSafeFetch("https://example.com/file.pdf");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://cdn.example.com/file.pdf",
    );
  });

  it("blocks a redirect that points at an internal address", async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === "example.com"
        ? [{ address: "93.184.216.34" }]
        : [{ address: "10.0.0.5" }],
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.com/secret" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a metadata IP literal", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: "http://169.254.169.254/latest/" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("throws once the redirect limit is exceeded", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/loop" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      ssrfSafeFetch("https://example.com/file.pdf"),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SSRF_FETCH_REDIRECTS + 1);
  });
});
