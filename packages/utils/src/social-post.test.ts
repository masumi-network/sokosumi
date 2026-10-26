import { describe, expect, it } from "vitest";

import {
  SOCIAL_POST_FIRST_COMMENT_LIMITS,
  SOCIAL_POST_FIRST_COMMENT_MAX,
  SOCIAL_POST_MEDIA_MAX,
  SOCIAL_POST_MEDIA_REQUIREMENTS,
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  SOCIAL_POST_TEXT_LIMITS,
  SOCIAL_POST_TEXT_MAX,
  SOCIAL_POST_TEXT_REQUIRED,
  type SocialPostMediaRef,
  socialPostFirstCommentLimit,
  socialPostMaxBytesForKind,
  socialPostMediaKindForMime,
  socialPostMediaRequirementMessage,
  socialPostMeetsMediaRequirement,
  socialPostMimeForFileName,
  socialPostProviderLabel,
  socialPostSupportsFirstComment,
  socialPostTextLength,
  socialPostTextLimit,
  splitYouTubePostText,
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
  it.each(["Basic", "Premium", "PremiumPlus"])(
    "allows long X posts for %s accounts",
    (subscriptionType) => {
      expect(socialPostTextLimit("x", subscriptionType)).toBe(25_000);
    },
  );

  it.each(["None", null, undefined, "unknown", "premium"])(
    "keeps the default X limit for %s",
    (subscriptionType) => {
      expect(socialPostTextLimit("x", subscriptionType)).toBe(280);
    },
  );

  it.each([
    ["x", 280],
    ["linkedin", 3000],
    ["facebook", 63206],
    ["instagram", 2200],
    ["tiktok", 2200],
    ["youtube", 5000],
  ] as const)("caps %s text at %i characters", (provider, limit) => {
    expect(SOCIAL_POST_TEXT_LIMITS[provider]).toBe(limit);
    expect(socialPostTextLimit(provider)).toBe(limit);
    if (provider !== "x") {
      expect(socialPostTextLimit(provider, "Premium")).toBe(limit);
    }
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

  it.each([
    ["x", true, null],
    ["linkedin", true, null],
    ["facebook", true, null],
    ["instagram", false, "Instagram requires at least one image or video"],
    ["tiktok", false, "TikTok requires a video"],
    ["youtube", false, "YouTube requires a video"],
  ] as const)(
    "treats empty media on %s as ready=%s",
    (provider, ready, message) => {
      expect(socialPostMeetsMediaRequirement(provider, [])).toBe(ready);
      expect(socialPostMediaRequirementMessage(provider)).toBe(message);
    },
  );

  it("accepts one video for TikTok and YouTube, and any file for Instagram", () => {
    expect(socialPostMeetsMediaRequirement("tiktok", [video])).toBe(true);
    expect(socialPostMeetsMediaRequirement("tiktok", [image])).toBe(false);
    expect(socialPostMeetsMediaRequirement("youtube", [video])).toBe(true);
    expect(socialPostMeetsMediaRequirement("instagram", [jpeg])).toBe(true);
  });

  it("exposes the strictest request bounds and the schedule lead", () => {
    expect(SOCIAL_POST_TEXT_MAX).toBe(SOCIAL_POST_TEXT_LIMITS.facebook);
    expect(SOCIAL_POST_MEDIA_MAX).toBe(4);
    expect(SOCIAL_POST_MIN_SCHEDULE_LEAD_MS).toBe(60_000);
    expect(SOCIAL_POST_TEXT_MAX).toBeGreaterThan(SOCIAL_POST_TEXT_LIMITS.x);
  });

  it.each([
    ["x", 280],
    ["linkedin", 1250],
    ["facebook", 8000],
    ["instagram", 300],
    ["youtube", 10_000],
  ] as const)("caps %s first comments at %i characters", (provider, limit) => {
    expect(SOCIAL_POST_FIRST_COMMENT_LIMITS[provider]).toBe(limit);
    expect(socialPostFirstCommentLimit(provider)).toBe(limit);
    expect(socialPostSupportsFirstComment(provider)).toBe(true);
  });

  it("leaves TikTok without a first comment", () => {
    expect(socialPostFirstCommentLimit("tiktok")).toBeNull();
    expect(socialPostSupportsFirstComment("tiktok")).toBe(false);
    expect(SOCIAL_POST_FIRST_COMMENT_MAX).toBe(25_000);
  });
});

describe("socialPostTextLength", () => {
  it.each([
    ["https://example.com/very/long/path", 23],
    ["http://example.com/very/long/path", 23],
    ["https://file.txt/very/long/path", 23],
    ["#https://example.com/very/long/path", 24],
    ["$http://example.com/very/long/path", 24],
    ["https://example.com/a-very-long-url", 23],
    ["Read https://example.com/a-very-long-url", 28],
    ["https://example.com/hello.", 24],
    ["example.com.", 24],
    ["https://example.com/hello_(world)", 23],
    ["(https://example.com/hello)", 25],
    ["example.com", 23],
    ["EXAMPLE.COM", 23],
    ["sokosumi.io/x", 23],
    ["SOKOSUMI.IO/x", 23],
    ["sokosumi.io", 11],
    ["bit.ly", 6],
    ["bit.ly/x", 23],
    ["bit.ly/", 23],
    ["www.bit.ly", 23],
    ["a.b.io", 23],
    ["example.co", 23],
    ["EXAMPLE.CO", 23],
    ["example.tv", 23],
    ["file.txt", 8],
    ["e.g.", 4],
    ["www.example.com", 23],
    ["www.file.txt", 12],
    ["example.com123", 14],
    ["example.com.unknown", 19],
    ["example.世界", 23],
    ["example.中国/x", 23],
    ["https://example.com/path😀", 25],
    ["https://example.com/path中文", 27],
    ["https://example.com/path?x=one😀", 25],
    ['https://example.com/path"hello"', 30],
    ["https://example.com/path】abc", 28],
    ["https://example.com/path\\abc", 27],
    [`中文https://example.com/${"a".repeat(260)}`, 27],
    ["中文example.com/path", 27],
    ["example.com中文", 27],
    ["https://example.com中文", 27],
    ["https://example.com/路径https://example.org/path", 50],
    ["https://✪df.ws/ejp", 23],
    ["https://☃.net/long/path", 23],
    ["https://example.com/path@", 24],
    ["https://example.com/path[", 24],
    ["https://example.com/path]", 24],
    ["https://example.com/path|", 24],
    ["https://example.com/path&", 24],
    ["https://example.com/path(foo", 27],
    ["https://example.com/path?[]", 26],
    ["_https://example.com/path", 24],
    ["😀", 2],
    ["👨‍👩‍👧‍👦", 2],
    ["👍🏽", 2],
    ["🇯🇵", 2],
    ["1️⃣", 2],
    ["中文", 4],
    ["中", 2],
    ["cafe\u0301", 4],
    ["Hello world", 11],
  ])("counts %j as %i on X", (text, length) => {
    expect(socialPostTextLength("x", text)).toBe(length);
  });

  it.each(["@", "＠", "$", "#", "＃", "_", "user_"])(
    "keeps bare domains after %j as plain text",
    (prefix) => {
      const text = `${prefix}www.example.com/path`;
      const prefixLength =
        prefix === "＠" || prefix === "＃" ? 2 : prefix.length;
      expect(socialPostTextLength("x", text)).toBe(prefixLength + 20);
    },
  );

  it.each([
    [0x0000, 1],
    [0x10ff, 1],
    [0x1100, 2],
    [0x1fff, 2],
    [0x2000, 1],
    [0x200d, 1],
    [0x200e, 2],
    [0x200f, 2],
    [0x2010, 1],
    [0x201f, 1],
    [0x2020, 2],
    [0x2031, 2],
    [0x2032, 1],
    [0x2037, 1],
    [0x2038, 2],
  ])("weights code point %i as %i on X", (point, length) => {
    expect(socialPostTextLength("x", String.fromCodePoint(point))).toBe(length);
  });

  it("allows a 300-character post with a long link on a free X account", () => {
    const text = `${"a".repeat(240)} https://example.com/${"b".repeat(39)}`;
    expect(text).toHaveLength(300);
    expect(socialPostTextLength("x", text)).toBe(264);
    expect(socialPostTextLength("x", text)).toBeLessThanOrEqual(
      socialPostTextLimit("x"),
    );
  });

  it("counts emoji immediately after a URL toward the free X account limit", () => {
    const text = `${"a".repeat(255)} https://example.com/path😀`;
    expect(socialPostTextLength("x", text)).toBe(281);
    expect(socialPostTextLength("x", text)).toBeGreaterThan(
      socialPostTextLimit("x"),
    );
  });

  it("counts a long dangling-dot hostname as plain text", () => {
    const text = `${"a".repeat(100_000)}.`;
    expect(socialPostTextLength("x", text)).toBe(text.length);
  });

  it.each(["a", "中"])("counts long %s text before a URL", (character) => {
    const text = character.repeat(100_000);
    expect(socialPostTextLength("x", `${text} https://example.com/`)).toBe(
      socialPostTextLength("x", text) + 24,
    );
  });

  it.each(["linkedin", "facebook", "instagram", "tiktok", "youtube"] as const)(
    "preserves UTF-16 counting on %s",
    (provider) => {
      const text = "👨‍👩‍👧‍👦 中文 https://example.com/hello";
      expect(socialPostTextLength(provider, text)).toBe(text.length);
    },
  );

  it.each(["Basic", "Premium", "PremiumPlus"])(
    "applies the %s tier to X replies as well as posts",
    (tier) => {
      expect(socialPostFirstCommentLimit("x", tier)).toBe(25_000);
    },
  );
});

describe("splitYouTubePostText", () => {
  it("uses the first non-empty line as the trimmed title", () => {
    expect(splitYouTubePostText("\n  Launch today  \nmore text")).toEqual({
      title: "Launch today",
      description: "more text",
    });
  });

  it("caps the title at 100 characters and keeps the leftover", () => {
    expect(splitYouTubePostText("T".repeat(140))).toEqual({
      title: "T".repeat(100),
      description: "T".repeat(40),
    });
  });

  it.each(["Launching today", "T".repeat(100)])(
    "leaves the description empty for a title-only post: %s",
    (text) => {
      expect(splitYouTubePostText(text)).toEqual({
        title: text,
        description: "",
      });
    },
  );

  it("trims the leftover of a long title line", () => {
    const firstLine = `${"T".repeat(100)} leftover caption`;
    expect(splitYouTubePostText(firstLine)).toEqual({
      title: "T".repeat(100),
      description: "leftover caption",
    });
  });

  it("keeps first-line leftover ahead of later lines", () => {
    const firstLine = `${"T".repeat(100)} leftover`;
    expect(splitYouTubePostText(`${firstLine}\nSecond line`)).toEqual({
      title: "T".repeat(100),
      description: "leftover\nSecond line",
    });
  });

  it.each(["", "   \n  "])("leaves blank text empty: %j", (text) => {
    expect(splitYouTubePostText(text)).toEqual({ title: "", description: "" });
  });

  it("normalizes CRLF and preserves paragraphs and interior whitespace", () => {
    expect(
      splitYouTubePostText(
        "\r\n  Launch today  \r\n  First  paragraph\r\n\r\n  Second paragraph  \r\n",
      ),
    ).toEqual({
      title: "Launch today",
      description: "First  paragraph\n\n  Second paragraph",
    });
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
    ["  image/png  ", "image"],
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

  it("accepts a padded mime type the provider already allows", () => {
    expect(
      validateSocialPostMedia("x", [ref({ mimeType: "  image/png  " })]),
    ).toEqual({ ok: true });
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
