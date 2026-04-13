import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("legacy share job page", () => {
  it("redirects legacy job URLs to the canonical share route", async () => {
    const { default: LegacySharedJobPage } = await import("./page");

    await expect(
      LegacySharedJobPage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    ).rejects.toMatchObject({ message: "redirect" });

    expect(redirectMock).toHaveBeenCalledWith("/share/public-share-token");
  });
});
