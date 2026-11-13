import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));
vi.mock("@vercel/blob", () => mocks);

import { privateBlobReadUrl } from "./blob-read-url";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueSignedToken.mockResolvedValue("signed-test-capability");
  mocks.presignUrl.mockResolvedValue({
    presignedUrl: "https://blob.example/image?signature=test",
  });
});

describe("private blob read URL", () => {
  it("scopes a short-lived capability to one private object and read operation", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(now);
    expect(
      await privateBlobReadUrl(
        "projects/asset.png",
        "studio-test-store",
        600_000,
      ),
    ).toBe("https://blob.example/image?signature=test");
    expect(mocks.issueSignedToken).toHaveBeenCalledWith({
      token: "studio-test-store",
      pathname: "projects/asset.png",
      operations: ["get"],
      validUntil: now + 600_000,
    });
    expect(mocks.presignUrl).toHaveBeenCalledWith("signed-test-capability", {
      operation: "get",
      pathname: "projects/asset.png",
      access: "private",
      validUntil: now + 600_000,
    });
  });

  it("propagates signing failures without falling back to a public URL", async () => {
    mocks.issueSignedToken.mockRejectedValue(new Error("signing unavailable"));
    await expect(
      privateBlobReadUrl("projects/asset.png", "studio-test-store", 600_000),
    ).rejects.toThrow("signing unavailable");
    expect(mocks.presignUrl).not.toHaveBeenCalled();
  });
});
