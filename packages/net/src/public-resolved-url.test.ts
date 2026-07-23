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
  ])("blocks %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])(
    "allows public address %s",
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(false);
    },
  );
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
