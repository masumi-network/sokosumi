import type { SocialPostMediaRef } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  socialPostComposerAccept,
  socialPostComposerIssue,
} from "./social-post-composer-rules";

function ref(kind: "image" | "video", mimeType: string): SocialPostMediaRef {
  return {
    pathname: `drive/users/user_1/file-${kind}`,
    fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/file-${kind}`,
    name: `file-${kind}`,
    size: 3,
    mimeType,
    kind,
  };
}

const IMAGE = ref("image", "image/jpeg");
const VIDEO = ref("video", "video/mp4");

describe("socialPostComposerIssue", () => {
  it.each([
    ["x", "", [], "text_or_media_required"],
    ["x", "", [IMAGE], null],
    ["facebook", "", [], "text_or_media_required"],
    ["linkedin", "", [IMAGE], "text_required"],
    ["linkedin", "Hello", [], null],
    ["instagram", "Hello", [], "media_required"],
    ["instagram", "Hello", [IMAGE], null],
    ["tiktok", "Hello", [IMAGE], "video_required"],
    ["tiktok", "Hello", [VIDEO], null],
    ["youtube", "Hello", [], "video_required"],
    ["youtube", "", [VIDEO], "text_required"],
    ["youtube", "Hello", [VIDEO], null],
    ["instagram", "Hello", [ref("image", "image/png")], "unsupported_type"],
    ["x", "Hello", [IMAGE, VIDEO], "mixed_media"],
  ] as const)(
    "scores %s text=%s media=%s",
    (provider, text, media, expected) => {
      expect(socialPostComposerIssue(provider, text, [...media])).toBe(
        expected,
      );
    },
  );
});

describe("socialPostComposerAccept", () => {
  it("lists the provider's accepted MIME types", () => {
    expect(socialPostComposerAccept("instagram")).toBe(
      "image/jpeg,video/mp4,video/quicktime",
    );
    expect(socialPostComposerAccept("x")).toContain("image/png");
    expect(socialPostComposerAccept("tiktok")).toBe("video/mp4");
  });
});
