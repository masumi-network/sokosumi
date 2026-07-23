import { SsrfError } from "@sokosumi/net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPublicResolvedHttpUrlMock } = vi.hoisted(() => ({
  assertPublicResolvedHttpUrlMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  assertPublicResolvedHttpUrl: assertPublicResolvedHttpUrlMock,
  SsrfError: class SsrfError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SsrfError";
    }
  },
}));

import {
  assertSafePdfResourceUrl,
  isAllowedLocalBrowserUrl,
} from "@/lib/utils/pdf-export-ssrf";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pdf-export-ssrf helpers", () => {
  it("allows local browser schemes without DNS checks", () => {
    expect(isAllowedLocalBrowserUrl("data:image/png;base64,abc")).toBe(true);
    expect(isAllowedLocalBrowserUrl("about:blank")).toBe(true);
    expect(isAllowedLocalBrowserUrl("https://example.com")).toBe(false);
  });

  it("delegates http(s) URLs to assertPublicResolvedHttpUrl", async () => {
    assertPublicResolvedHttpUrlMock.mockResolvedValue(
      new URL("https://cdn.example/a.png"),
    );
    await expect(
      assertSafePdfResourceUrl("https://cdn.example/a.png"),
    ).resolves.toBeUndefined();
    expect(assertPublicResolvedHttpUrlMock).toHaveBeenCalledWith(
      "https://cdn.example/a.png",
    );
  });

  it("propagates SSRF errors for blocked targets", async () => {
    assertPublicResolvedHttpUrlMock.mockRejectedValue(
      new SsrfError("Blocked IP address: 169.254.169.254"),
    );
    await expect(
      assertSafePdfResourceUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});
