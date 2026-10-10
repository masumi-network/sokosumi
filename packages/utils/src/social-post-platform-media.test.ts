import { describe, expect, it } from "vitest";

import {
  type SocialPostMediaRef,
  validateSocialPostMedia,
} from "./social-post.js";

function ref(overrides: Partial<SocialPostMediaRef> = {}): SocialPostMediaRef {
  return {
    pathname: "drive/users/user_1/photo.jpg",
    fileUrl:
      "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.jpg",
    name: "photo.jpg",
    size: 1024,
    mimeType: "image/jpeg",
    kind: "image",
    ...overrides,
  };
}

const jpeg = ref();
const webp = ref({
  name: "photo.webp",
  mimeType: "image/webp",
});

describe("validateSocialPostMedia platform limits", () => {
  it("rejects a second Instagram image", () => {
    expect(validateSocialPostMedia("instagram", [jpeg])).toEqual({ ok: true });
    expect(validateSocialPostMedia("instagram", [jpeg, jpeg])).toEqual({
      ok: false,
      reason: "too_many_images",
    });
  });

  it("accepts webp on Facebook and X, not LinkedIn", () => {
    expect(validateSocialPostMedia("facebook", [webp])).toEqual({ ok: true });
    expect(validateSocialPostMedia("x", [webp])).toEqual({ ok: true });
    expect(validateSocialPostMedia("linkedin", [webp])).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });
});
