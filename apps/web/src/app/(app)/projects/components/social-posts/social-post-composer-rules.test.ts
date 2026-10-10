import type { SocialPostMediaRef } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  socialPostComposerAccept,
  socialPostComposerFormat,
  socialPostComposerIssue,
  socialPostComposerProviders,
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
    ["x", "   ", [], "text_or_media_required"],
    ["linkedin", "   ", [], "text_required"],
    ["facebook", "", [], "text_or_media_required"],
    ["facebook", "Hello", [], null],
    ["facebook", "", [IMAGE], null],
  ] as const)(
    "scores %s text=%s media=%s",
    (provider, text, media, expected) => {
      expect(socialPostComposerIssue(provider, text, [...media])).toBe(
        expected,
      );
    },
  );
});

describe("socialPostComposerProviders", () => {
  it("prefers the selected connections over the stored post provider", () => {
    expect(socialPostComposerProviders("x", ["linkedin"])).toEqual([
      "linkedin",
    ]);
    expect(socialPostComposerProviders("instagram", [])).toEqual(["instagram"]);
    expect(socialPostComposerProviders(undefined, [])).toEqual(["x"]);
  });

  it("lists each selected provider once", () => {
    expect(
      socialPostComposerProviders(undefined, ["x", "linkedin", "x"]),
    ).toEqual(["x", "linkedin"]);
  });

  it("keeps facebook when it is the only selected connection", () => {
    expect(socialPostComposerProviders("x", ["facebook"])).toEqual([
      "facebook",
    ]);
  });
});

describe("socialPostComposerAccept", () => {
  it("lists the provider's accepted MIME types", () => {
    expect(socialPostComposerAccept(["instagram"])).toBe(
      "image/jpeg,video/mp4,video/quicktime",
    );
    expect(socialPostComposerAccept(["x"])).toContain("image/png");
    expect(socialPostComposerAccept(["tiktok"])).toBe("video/mp4");
  });

  it("accepts only what every selected provider takes", () => {
    expect(socialPostComposerAccept(["x", "instagram"])).not.toContain(
      "image/png",
    );
    expect(socialPostComposerAccept(["x", "tiktok"])).toBe("video/mp4");
  });

  it("accepts nothing when no provider is selected", () => {
    expect(socialPostComposerAccept([])).toBe("");
  });

  it("keeps jpeg when facebook and linkedin are both selected", () => {
    expect(socialPostComposerAccept(["facebook", "linkedin"])).toBe(
      "image/jpeg,image/png,video/mp4",
    );
  });
});

describe("socialPostComposerFormat", () => {
  it("names what each provider publishes", () => {
    expect(socialPostComposerFormat("x")).toBe("post");
    expect(socialPostComposerFormat("linkedin")).toBe("post");
    expect(socialPostComposerFormat("instagram")).toBe("mediaPost");
    expect(socialPostComposerFormat("youtube")).toBe("video");
    expect(socialPostComposerFormat("tiktok")).toBe("video");
    expect(socialPostComposerFormat("facebook")).toBe("post");
  });
});
