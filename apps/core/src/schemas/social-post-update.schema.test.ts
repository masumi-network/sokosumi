import { SOCIAL_POST_MEDIA_MAX, SOCIAL_POST_TEXT_MAX } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { updateSocialPostRequestSchema } from "./social-post.schema";

const media = {
  pathname: "drive/users/user_1/photo.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.png",
  name: "photo.png",
  size: 2048,
  mimeType: "image/png",
  kind: "image" as const,
};

describe("updateSocialPostRequestSchema", () => {
  it("requires a non-negative revision", () => {
    expect(
      updateSocialPostRequestSchema.safeParse({ text: "Hi" }).success,
    ).toBe(false);
    expect(
      updateSocialPostRequestSchema.safeParse({ revision: -1 }).success,
    ).toBe(false);
    expect(
      updateSocialPostRequestSchema.safeParse({ revision: 0 }).success,
    ).toBe(true);
  });

  it("accepts a null account and trims text", () => {
    const result = updateSocialPostRequestSchema.safeParse({
      revision: 1,
      text: "  Hello  ",
      socialConnectionId: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.text).toBe("Hello");
    expect(result.data.socialConnectionId).toBeNull();
  });

  it("rejects text over the Facebook ceiling", () => {
    expect(
      updateSocialPostRequestSchema.safeParse({
        revision: 1,
        text: "x".repeat(SOCIAL_POST_TEXT_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects more attachments than any provider accepts", () => {
    expect(
      updateSocialPostRequestSchema.safeParse({
        revision: 1,
        media: Array.from(
          { length: SOCIAL_POST_MEDIA_MAX + 1 },
          (_, index) => ({
            ...media,
            pathname: `drive/users/user_1/photo-${index}.png`,
            fileUrl: `${media.fileUrl}-${index}`,
            name: `photo-${index}.png`,
          }),
        ),
      }).success,
    ).toBe(false);
  });
});
