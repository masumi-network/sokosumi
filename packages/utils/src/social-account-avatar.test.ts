import { describe, expect, it } from "vitest";

import {
  buildSocialAccountAvatarPathname,
  isOwnedSocialAccountAvatarUrl,
  isSocialAccountAvatarAllowedContentType,
} from "./social-account-avatar.js";

describe("social account avatar", () => {
  it("builds a Project-scoped pathname from provider and account", () => {
    expect(
      buildSocialAccountAvatarPathname("p1", "x", "123", "image/jpeg"),
    ).toBe("social-avatars/p1/image-x-123.jpg");
  });

  it("owns only Blob URLs under the Project prefix", () => {
    const host = "https://abc.public.blob.vercel-storage.com";
    expect(
      isOwnedSocialAccountAvatarUrl(
        `${host}/social-avatars/p1/image-x-123-rand.jpg`,
        "p1",
      ),
    ).toBe(true);
    expect(
      isOwnedSocialAccountAvatarUrl(
        `${host}/social-avatars/p2/image-x-123.jpg`,
        "p1",
      ),
    ).toBe(false);
    expect(
      isOwnedSocialAccountAvatarUrl("https://pbs.twimg.com/a.jpg", "p1"),
    ).toBe(false);
  });

  it("rejects SVG", () => {
    expect(isSocialAccountAvatarAllowedContentType("image/png")).toBe(true);
    expect(isSocialAccountAvatarAllowedContentType("image/svg+xml")).toBe(
      false,
    );
  });
});
