import { describe, expect, it } from "vitest";
import { tiktokPublishedVideoId } from "@/clients/social-post-providers/tiktok-video-id";

describe("tiktokPublishedVideoId", () => {
  it("prefers a numeric publicaly_available_post_id over placeholders", () => {
    expect(
      tiktokPublishedVideoId({
        publicaly_available_post_id: ["video_9", "751234567890"],
        post_id: "ignored",
        id: "also-ignored",
      }),
    ).toBe("751234567890");
  });

  it("reads a single numeric post_id when the publish array is empty", () => {
    expect(tiktokPublishedVideoId({ post_id: "42" })).toBe("42");
  });

  it("rejects publish ids and non-numeric placeholders", () => {
    expect(
      tiktokPublishedVideoId({
        publicaly_available_post_id: ["video_9"],
        publish_id: "v_pub_123",
        id: "pub_1",
      }),
    ).toBeNull();
  });
});
