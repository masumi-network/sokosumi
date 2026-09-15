import { describe, expect, it } from "vitest";

import {
  SOCIAL_POST_MEDIA_RULES,
  type SocialPostMediaRef,
  socialPostMediaKindForMime,
  socialPostMimeForFileName,
  validateSocialPostMedia,
} from "./social-post.js";

function ref(overrides: Partial<SocialPostMediaRef> = {}): SocialPostMediaRef {
  return {
    pathname: "drive/users/user_1/photo.png",
    fileUrl:
      "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.png",
    name: "photo.png",
    size: 1024,
    mimeType: "image/png",
    kind: "image",
    ...overrides,
  };
}

const image = ref();
const gif = ref({ name: "loop.gif", mimeType: "image/gif", kind: "gif" });
const video = ref({ name: "clip.mp4", mimeType: "video/mp4", kind: "video" });

describe("socialPostMediaKindForMime", () => {
  it.each([
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["image/webp", "image"],
    ["image/gif", "gif"],
    ["video/mp4", "video"],
    ["video/quicktime", "video"],
    ["IMAGE/PNG", "image"],
  ])("maps %s to %s", (mime, kind) => {
    expect(socialPostMediaKindForMime(mime)).toBe(kind);
  });

  it.each(["image/svg+xml", "application/pdf", "video/webm", ""])(
    "rejects unsupported %s",
    (mime) => {
      expect(socialPostMediaKindForMime(mime)).toBeNull();
    },
  );
});

describe("socialPostMimeForFileName", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.webp", "image/webp"],
    ["loop.gif", "image/gif"],
    ["clip.mp4", "video/mp4"],
    ["clip.mov", "video/quicktime"],
    ["folder/nested.name.PNG", "image/png"],
  ])("maps %s to %s", (name, mime) => {
    expect(socialPostMimeForFileName(name)).toBe(mime);
  });

  it.each(["report.pdf", "noext", ".png", "clip.webm"])(
    "returns null for %s",
    (name) => {
      expect(socialPostMimeForFileName(name)).toBeNull();
    },
  );
});

describe("validateSocialPostMedia", () => {
  it("accepts no media", () => {
    expect(validateSocialPostMedia("x", [])).toEqual({ ok: true });
  });

  it("accepts up to four images", () => {
    expect(validateSocialPostMedia("x", [image, image, image, image])).toEqual({
      ok: true,
    });
  });

  it("rejects a fifth image", () => {
    expect(
      validateSocialPostMedia("x", [image, image, image, image, image]),
    ).toEqual({ ok: false, reason: "too_many_images" });
  });

  it("accepts a single gif or video", () => {
    expect(validateSocialPostMedia("x", [gif])).toEqual({ ok: true });
    expect(validateSocialPostMedia("x", [video])).toEqual({ ok: true });
  });

  it("rejects more than one gif or video", () => {
    expect(validateSocialPostMedia("x", [gif, gif])).toEqual({
      ok: false,
      reason: "too_many_gifs",
    });
    expect(validateSocialPostMedia("x", [video, video])).toEqual({
      ok: false,
      reason: "too_many_videos",
    });
  });

  it("rejects mixed kinds", () => {
    expect(validateSocialPostMedia("x", [image, gif])).toEqual({
      ok: false,
      reason: "mixed_media",
    });
    expect(validateSocialPostMedia("x", [video, image])).toEqual({
      ok: false,
      reason: "mixed_media",
    });
  });

  it("rejects an unsupported mime type", () => {
    expect(
      validateSocialPostMedia("x", [
        ref({ mimeType: "image/svg+xml", kind: "image" }),
      ]),
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects a kind that does not match the mime type", () => {
    expect(
      validateSocialPostMedia("x", [
        ref({ mimeType: "image/gif", kind: "image" }),
      ]),
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("enforces per-kind byte caps", () => {
    const rules = SOCIAL_POST_MEDIA_RULES.x;
    expect(
      validateSocialPostMedia("x", [ref({ size: rules.maxImageBytes })]),
    ).toEqual({ ok: true });
    expect(
      validateSocialPostMedia("x", [ref({ size: rules.maxImageBytes + 1 })]),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateSocialPostMedia("x", [{ ...gif, size: rules.maxGifBytes + 1 }]),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateSocialPostMedia("x", [
        { ...video, size: rules.maxVideoBytes + 1 },
      ]),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateSocialPostMedia("x", [{ ...video, size: rules.maxVideoBytes }]),
    ).toEqual({ ok: true });
  });
});
