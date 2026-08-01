import { describe, expect, it } from "vitest";

import { isOwnedUserUploadUrl } from "../user-upload-owned.js";

describe("isOwnedUserUploadUrl", () => {
  it("detects owned user upload blob URLs", () => {
    expect(
      isOwnedUserUploadUrl(
        "https://abc.public.blob.vercel-storage.com/users/user_123/file.png",
        "user_123",
      ),
    ).toBe(true);
  });

  it("rejects uploads owned by a different user", () => {
    expect(
      isOwnedUserUploadUrl(
        "https://abc.public.blob.vercel-storage.com/users/user_999/file.png",
        "user_123",
      ),
    ).toBe(false);
  });

  it("rejects foreign hosts, OAuth URLs, and invalid input", () => {
    expect(
      isOwnedUserUploadUrl(
        "https://evil.example.com/users/user_123/file.png",
        "user_123",
      ),
    ).toBe(false);
    expect(
      isOwnedUserUploadUrl(
        "https://lh3.googleusercontent.com/a/xyz",
        "user_123",
      ),
    ).toBe(false);
    expect(isOwnedUserUploadUrl("not-a-url", "user_123")).toBe(false);
    expect(
      isOwnedUserUploadUrl(
        "https://abc.public.blob.vercel-storage.com/users/user_123/file.png",
        "",
      ),
    ).toBe(false);
  });
});
