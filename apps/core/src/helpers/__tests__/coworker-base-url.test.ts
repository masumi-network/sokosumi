import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPublicResolvedHttpUrlMock, TestSsrfError } = vi.hoisted(() => ({
  assertPublicResolvedHttpUrlMock: vi.fn(),
  TestSsrfError: class TestSsrfError extends Error {},
}));

vi.mock("@sokosumi/net", () => ({
  assertPublicResolvedHttpUrl: assertPublicResolvedHttpUrlMock,
  SsrfError: TestSsrfError,
}));

import {
  assertCoworkerBaseUrlIsPublic,
  assertCoworkerBaseUrlIsPublicForWrite,
} from "@/helpers/coworker-base-url";

describe("coworker base URL guard", () => {
  beforeEach(() => {
    assertPublicResolvedHttpUrlMock.mockReset();
  });

  it("accepts a publicly routable endpoint", async () => {
    assertPublicResolvedHttpUrlMock.mockResolvedValue(
      new URL("https://responses.example.com/v1"),
    );

    await expect(
      assertCoworkerBaseUrlIsPublic("https://responses.example.com/v1"),
    ).resolves.toBeUndefined();
    expect(assertPublicResolvedHttpUrlMock).toHaveBeenCalledWith(
      "https://responses.example.com/v1",
    );
  });

  it("propagates the SSRF rejection on the request path", async () => {
    assertPublicResolvedHttpUrlMock.mockRejectedValue(
      new TestSsrfError("Blocked IP address: 169.254.169.254"),
    );

    await expect(
      assertCoworkerBaseUrlIsPublic("http://169.254.169.254/latest/meta-data"),
    ).rejects.toBeInstanceOf(TestSsrfError);
  });

  it("surfaces a 422 with the reason on the write path", async () => {
    assertPublicResolvedHttpUrlMock.mockRejectedValue(
      new TestSsrfError("Blocked host: localhost"),
    );

    // An operator setting a bad endpoint should learn why, not get a 500 — so
    // assert the guard's reason survives, not just the status code.
    await expect(
      assertCoworkerBaseUrlIsPublicForWrite("http://localhost:8080"),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("Blocked host: localhost"),
    });
  });

  it("rethrows non-SSRF failures unchanged on the write path", async () => {
    const boom = new Error("dns module exploded");
    assertPublicResolvedHttpUrlMock.mockRejectedValue(boom);

    await expect(
      assertCoworkerBaseUrlIsPublicForWrite("https://responses.example.com/v1"),
    ).rejects.toBe(boom);
  });
});
