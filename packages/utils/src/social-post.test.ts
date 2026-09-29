import { describe, expect, it } from "vitest";

import {
  SOCIAL_POST_MEDIA_REQUIREMENTS,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_POST_TEXT_REQUIRED,
  type SocialPostMediaRef,
  socialPostMaxBytesForKind,
  socialPostMediaKindForMime,
  socialPostMimeForFileName,
  socialPostProviderLabel,
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
const jpeg = ref({ name: "photo.jpg", mimeType: "image/jpeg" });
const quicktime = ref({
  name: "clip.mov",
  mimeType: "video/quicktime",
  kind: "video",
});

describe("per-provider limits and requirements", () => {
  it.each([
    ["x", 280],
    ["linkedin", 3000],
    ["facebook", 63206],
    ["instagram", 2200],
    ["tiktok", 2200],
    ["youtube", 5000],
  ] as const)("caps %s text at %i characters", (provider, limit) => {
    expect(SOCIAL_POST_TEXT_LIMITS[provider]).toBe(limit);
  });

  it.each([
    ["x", false, "none"],
    ["linkedin", true, "none"],
    ["facebook", false, "none"],
    ["instagram", false, "any"],
    ["tiktok", false, "video"],
    ["youtube", true, "video"],
  ] as const)(
    "sets %s requirements: text=%s media=%s",
    (provider, textRequired, media) => {
      expect(SOCIAL_POST_TEXT_REQUIRED[provider]).toBe(textRequired);
      expect(SOCIAL_POST_MEDIA_REQUIREMENTS[provider]).toBe(media);
    },
  );

  it.each([
    ["x", "X"],
    ["linkedin", "LinkedIn"],
    ["facebook", "Facebook"],
    ["instagram", "Instagram"],
    ["tiktok", "TikTok"],
    ["youtube", "YouTube"],
  ] as const)("labels %s as %s", (provider, label) => {
    expect(socialPostProviderLabel(provider)).toBe(label);
  });
});

describe("socialPostMaxBytesForKind", () => {
  it("caps new-provider images at 8 MB and videos at 100 MB", () => {
    expect(socialPostMaxBytesForKind("instagram", "image")).toBe(
      8 * 1024 * 1024,
    );
    expect(socialPostMaxBytesForKind("linkedin", "image")).toBe(
      8 * 1024 * 1024,
    );
    expect(socialPostMaxBytesForKind("tiktok", "video")).toBe(
      100 * 1024 * 1024,
    );
    expect(socialPostMaxBytesForKind("youtube", "video")).toBe(
      100 * 1024 * 1024,
    );
  });

  it("keeps the existing X caps", () => {
    const rules = SOCIAL_POST_MEDIA_RULES.x;
    expect(socialPostMaxBytesForKind("x", "image")).toBe(rules.maxImageBytes);
    expect(socialPostMaxBytesForKind("x", "gif")).toBe(rules.maxGifBytes);
    expect(socialPostMaxBytesForKind("x", "video")).toBe(rules.maxVideoBytes);
  });
});

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
    ["folder/nested.name.PNG", "image/png"],
  ])("maps %s to %s", (name, mime) => {
    expect(socialPostMimeForFileName(name)).toBe(mime);
  });

  it.each(["report.pdf", "noext", ".png", "clip.mov", "clip.webm"])(
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

  it("accepts up to four images on linkedin and facebook", () => {
    expect(
      validateSocialPostMedia("linkedin", [image, image, image, image]),
    ).toEqual({ ok: true });
    expect(
      validateSocialPostMedia("facebook", [image, image, image, image]),
    ).toEqual({ ok: true });
  });

  it("rejects a fifth image on linkedin and facebook", () => {
    expect(
      validateSocialPostMedia("linkedin", [image, image, image, image, image]),
    ).toEqual({ ok: false, reason: "too_many_images" });
    expect(
      validateSocialPostMedia("facebook", [image, image, image, image, image]),
    ).toEqual({ ok: false, reason: "too_many_images" });
  });

  it("accepts jpeg but not png images on instagram", () => {
    expect(validateSocialPostMedia("instagram", [jpeg])).toEqual({ ok: true });
    expect(validateSocialPostMedia("instagram", [image])).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("rejects images on tiktok and youtube", () => {
    expect(validateSocialPostMedia("tiktok", [jpeg])).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
    expect(validateSocialPostMedia("youtube", [jpeg])).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("rejects two videos on instagram and facebook", () => {
    expect(validateSocialPostMedia("instagram", [video, video])).toEqual({
      ok: false,
      reason: "too_many_videos",
    });
    expect(validateSocialPostMedia("facebook", [video, video])).toEqual({
      ok: false,
      reason: "too_many_videos",
    });
  });

  it("accepts quicktime video only on instagram", () => {
    expect(validateSocialPostMedia("instagram", [quicktime])).toEqual({
      ok: true,
    });
    expect(validateSocialPostMedia("tiktok", [quicktime])).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("rejects gifs on every provider except X", () => {
    for (const provider of [
      "linkedin",
      "facebook",
      "instagram",
      "tiktok",
      "youtube",
    ] as const) {
      expect(validateSocialPostMedia(provider, [gif])).toEqual({
        ok: false,
        reason: "unsupported_type",
      });
    }
    expect(validateSocialPostMedia("x", [gif])).toEqual({ ok: true });
  });

  it("enforces new-provider byte caps", () => {
    expect(
      validateSocialPostMedia("instagram", [
        { ...jpeg, size: 8 * 1024 * 1024 },
      ]),
    ).toEqual({ ok: true });
    expect(
      validateSocialPostMedia("instagram", [
        { ...jpeg, size: 8 * 1024 * 1024 + 1 },
      ]),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateSocialPostMedia("tiktok", [
        { ...video, size: 100 * 1024 * 1024 + 1 },
      ]),
    ).toEqual({ ok: false, reason: "too_large" });
  });
});
