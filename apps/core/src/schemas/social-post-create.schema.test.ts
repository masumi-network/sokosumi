import { SOCIAL_POST_MEDIA_MAX, SOCIAL_POST_TEXT_MAX } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { createSocialPostRequestSchema } from "./social-post.schema";

const media = {
  pathname: "drive/users/user_1/photo.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.png",
  name: "photo.png",
  size: 2048,
  mimeType: "image/png",
  kind: "image" as const,
};

describe("createSocialPostRequestSchema", () => {
  it("rejects whitespace-only text without media", () => {
    expect(
      createSocialPostRequestSchema.safeParse({ text: "   " }).success,
    ).toBe(false);
  });

  it("accepts empty text when media is attached", () => {
    expect(
      createSocialPostRequestSchema.safeParse({ text: "   ", media: [media] })
        .success,
    ).toBe(true);
  });

  it("rejects more attachments than any provider accepts", () => {
    expect(
      createSocialPostRequestSchema.safeParse({
        text: "Hello",
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

  it("rejects text over the Facebook ceiling", () => {
    expect(
      createSocialPostRequestSchema.safeParse({
        text: "x".repeat(SOCIAL_POST_TEXT_MAX + 1),
      }).success,
    ).toBe(false);
  });
});
