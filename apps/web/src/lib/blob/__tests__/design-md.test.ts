import { describe, expect, it } from "vitest";

import { isAllowedDesignMdBlobUrl } from "../design-md";

describe("isAllowedDesignMdBlobUrl", () => {
  const userId = "user-123";

  it("rejects shared design-md blob URLs from other workspaces", () => {
    expect(
      isAllowedDesignMdBlobUrl(
        "https://store.public.blob.vercel-storage.com/design-md/42-hash.md",
        userId,
      ),
    ).toBe(false);
  });

  it("accepts user upload blob URLs for the authenticated user", () => {
    expect(
      isAllowedDesignMdBlobUrl(
        "https://store.public.blob.vercel-storage.com/users/user-123/design.md",
        userId,
      ),
    ).toBe(true);
  });

  it("rejects blob URLs for a different user prefix", () => {
    expect(
      isAllowedDesignMdBlobUrl(
        "https://store.public.blob.vercel-storage.com/users/other-user/design.md",
        userId,
      ),
    ).toBe(false);
  });

  it("rejects non-blob hosts", () => {
    expect(
      isAllowedDesignMdBlobUrl("https://evil.example/design.md", userId),
    ).toBe(false);
  });

  it("rejects non-https blob URLs", () => {
    expect(
      isAllowedDesignMdBlobUrl(
        "http://store.public.blob.vercel-storage.com/design-md/file.md",
        userId,
      ),
    ).toBe(false);
  });
});
