import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  assertPublicResolvedHttpUrl,
  isBlockedIpAddress,
} from "./public-resolved-url.js";
import { SsrfError } from "./ssrf-fetch.js";

describe("isBlockedIpAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.5.5",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    // Node/`URL` normalizes dotted mapped form to hex
    "::ffff:a9fe:a9fe",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
  ])("blocks %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2001:4860:4860::8888",
    "::ffff:5dbe:d822", // 93.184.216.34 (example.com)
    "64:ff9b::808:808", // NAT64 of 8.8.8.8
  ])("allows public address %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });
});

describe("assertPublicResolvedHttpUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-http schemes", async () => {
    await expect(
      assertPublicResolvedHttpUrl("file:///etc/passwd"),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects localhost hostname without DNS", async () => {
    await expect(
      assertPublicResolvedHttpUrl("http://localhost/secret"),
    ).rejects.toThrow(/Blocked host/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects private IP literals without DNS", async () => {
    await expect(
      assertPublicResolvedHttpUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/Blocked IP/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 metadata URLs after URL normalization", async () => {
    // Node normalizes [::ffff:169.254.169.254] → [::ffff:a9fe:a9fe]
    const dottedMapped = "http://[::ffff:169.254.169.254]/latest/meta-data/";
    expect(new URL(dottedMapped).hostname).toContain("a9fe:a9fe");
    await expect(assertPublicResolvedHttpUrl(dottedMapped)).rejects.toThrow(
      /Blocked IP/,
    );
    await expect(
      assertPublicResolvedHttpUrl(
        "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
      ),
    ).rejects.toThrow(/Blocked IP/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects hosts that resolve to private addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(
      assertPublicResolvedHttpUrl("https://evil.example/x"),
    ).rejects.toThrow(/blocked address/);
  });

  it("allows hosts that resolve only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertPublicResolvedHttpUrl(
      "https://example.com/img.png",
    );
    expect(url.href).toBe("https://example.com/img.png");
  });
});
