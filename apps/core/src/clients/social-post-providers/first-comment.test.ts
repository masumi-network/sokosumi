import type { SocialPostProvider } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSessionMock, executeToolMock, deleteSessionMock } = vi.hoisted(
  () => ({
    createSessionMock: vi.fn(),
    executeToolMock: vi.fn(),
    deleteSessionMock: vi.fn(),
  }),
);

vi.mock("@/clients/composio.client", () => ({
  deleteComposioToolSession: deleteSessionMock,
}));

vi.mock("@/clients/social-post-providers/tools", () => ({
  createComposioToolSession: createSessionMock,
  executeComposioTool: executeToolMock,
}));

import {
  publishSocialPostFirstComment,
  socialPostFirstCommentTool,
} from "./first-comment";

const base = {
  connectedAccountId: "ca_1",
  executorUserId: "user_1",
  externalAccountId: "ext_1",
  externalId: "1907",
  text: " #launch ",
};

describe("socialPostFirstCommentTool", () => {
  it("covers every Composio comment network and skips TikTok", () => {
    expect(socialPostFirstCommentTool("x")?.toolSlug).toBe(
      "TWITTER_CREATION_OF_A_POST",
    );
    expect(socialPostFirstCommentTool("linkedin")?.toolSlug).toBe(
      "LINKEDIN_CREATE_COMMENT_ON_POST",
    );
    expect(socialPostFirstCommentTool("facebook")?.toolSlug).toBe(
      "FACEBOOK_CREATE_COMMENT",
    );
    expect(socialPostFirstCommentTool("instagram")?.toolSlug).toBe(
      "INSTAGRAM_POST_IG_MEDIA_COMMENTS",
    );
    expect(socialPostFirstCommentTool("youtube")?.toolSlug).toBe(
      "YOUTUBE_POST_COMMENT",
    );
    expect(socialPostFirstCommentTool("tiktok")).toBeNull();
  });
});

describe("publishSocialPostFirstComment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockResolvedValue({ id: "c1" });
    deleteSessionMock.mockResolvedValue(undefined);
  });

  it("skips TikTok, blank text, and over-limit Instagram comments", async () => {
    await publishSocialPostFirstComment({
      ...base,
      provider: "tiktok",
    });
    await publishSocialPostFirstComment({
      ...base,
      provider: "x",
      text: "   ",
    });
    await publishSocialPostFirstComment({
      ...base,
      provider: "instagram",
      text: "x".repeat(301),
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("replies on X with the published tweet id", async () => {
    await publishSocialPostFirstComment({ ...base, provider: "x" });
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "twitter",
        toolSlugs: ["TWITTER_CREATION_OF_A_POST"],
      }),
    );
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "TWITTER_CREATION_OF_A_POST",
        arguments: {
          text: "#launch",
          reply_in_reply_to_tweet_id: "1907",
        },
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it.each(["Basic", "Premium", "PremiumPlus"])(
    "sends a long X reply for %s",
    async (subscriptionType) => {
      const text = "x".repeat(5000);
      await publishSocialPostFirstComment({
        ...base,
        provider: "x",
        subscriptionType,
        text,
      });
      expect(executeToolMock).toHaveBeenCalledWith(
        expect.objectContaining({
          arguments: { text, reply_in_reply_to_tweet_id: "1907" },
        }),
      );
    },
  );

  it("uses weighted X reply length, including shortened URLs and emoji sequences", async () => {
    const text = `${"x".repeat(250)} 👨‍👩‍👧‍👦 https://example.com/${"p".repeat(100)}`;
    await publishSocialPostFirstComment({ ...base, provider: "x", text });
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: { text, reply_in_reply_to_tweet_id: "1907" },
      }),
    );
  });

  it.each([null, "None"])(
    "skips a long reply without an eligible X tier: %s",
    async (subscriptionType) => {
      await publishSocialPostFirstComment({
        ...base,
        provider: "x",
        subscriptionType,
        text: "x".repeat(5000),
      });
      expect(createSessionMock).not.toHaveBeenCalled();
    },
  );

  it("comments on LinkedIn with a share URN", async () => {
    await publishSocialPostFirstComment({
      ...base,
      provider: "linkedin",
      externalId: "urn:li:ugcPost:99",
    });
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "LINKEDIN_CREATE_COMMENT_ON_POST",
        arguments: {
          actor: "urn:li:person:ext_1",
          object: "urn:li:ugcPost:99",
          target_urn: "urn:li:ugcPost:99",
          message: { text: "#launch" },
        },
      }),
    );
  });

  it("wraps a bare LinkedIn id and skips activity URNs", async () => {
    await publishSocialPostFirstComment({
      ...base,
      provider: "linkedin",
      externalId: "abc",
    });
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          object: "urn:li:share:abc",
          target_urn: "urn:li:share:abc",
        }),
      }),
    );
    executeToolMock.mockClear();
    createSessionMock.mockClear();
    await publishSocialPostFirstComment({
      ...base,
      provider: "linkedin",
      externalId: "urn:li:activity:1",
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "facebook",
      "FACEBOOK_CREATE_COMMENT",
      { message: "#launch", object_id: "1907" },
    ],
    [
      "instagram",
      "INSTAGRAM_POST_IG_MEDIA_COMMENTS",
      { message: "#launch", ig_media_id: "1907" },
    ],
    [
      "youtube",
      "YOUTUBE_POST_COMMENT",
      {
        videoId: "1907",
        channelId: "ext_1",
        textOriginal: "#launch",
      },
    ],
  ] as const)(
    "posts a %s first comment",
    async (provider, toolSlug, arguments_) => {
      await publishSocialPostFirstComment({
        ...base,
        provider: provider as SocialPostProvider,
      });
      expect(executeToolMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolSlug,
          arguments: arguments_,
        }),
      );
    },
  );

  it("deletes the session when the comment tool refuses", async () => {
    executeToolMock.mockRejectedValue(new Error("refused"));
    await expect(
      publishSocialPostFirstComment({ ...base, provider: "x" }),
    ).rejects.toThrow("refused");
    expect(deleteSessionMock).toHaveBeenCalled();
  });
});
