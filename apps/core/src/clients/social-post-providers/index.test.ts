import type { SocialPostProvider } from "@sokosumi/utils";
import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import { ComposioToolError } from "@/clients/social-post-providers/tools";
import type { SocialPostPublishContext } from "@/clients/social-post-providers/types";

const adapters = vi.hoisted(() => ({
  facebook: vi.fn(),
  instagram: vi.fn(),
  linkedin: vi.fn(),
  tiktok: vi.fn(),
  x: vi.fn(),
  youtube: vi.fn(),
}));

vi.mock("@/clients/social-post-providers/facebook", () => ({
  publishFacebookPost: adapters.facebook,
}));
vi.mock("@/clients/social-post-providers/instagram", () => ({
  publishInstagramPost: adapters.instagram,
}));
vi.mock("@/clients/social-post-providers/linkedin", () => ({
  publishLinkedInPost: adapters.linkedin,
}));
vi.mock("@/clients/social-post-providers/tiktok", () => ({
  publishTikTokVideo: adapters.tiktok,
}));
vi.mock("@/clients/social-post-providers/x", () => ({
  publishXPost: adapters.x,
}));
vi.mock("@/clients/social-post-providers/youtube", () => ({
  publishYouTubeVideo: adapters.youtube,
}));

import {
  publishSocialPostToProvider,
  SOCIAL_POST_ATTEMPT_TOOL_SLUGS,
} from "./index";

function context(provider: SocialPostProvider): SocialPostPublishContext {
  return {
    provider,
    connectedAccountId: "ca_1",
    executorUserId: "user_1",
    externalAccountId: "ext_1",
    externalHandle: "sokosumi",
    text: "hello",
    media: [],
  };
}

describe("SOCIAL_POST_ATTEMPT_TOOL_SLUGS", () => {
  it("records a create tool for every Social provider", () => {
    expect(Object.keys(SOCIAL_POST_ATTEMPT_TOOL_SLUGS).toSorted()).toEqual(
      Object.keys(SOCIAL_POST_TEXT_LIMITS).toSorted(),
    );
    expect(SOCIAL_POST_ATTEMPT_TOOL_SLUGS).toEqual({
      x: "TWITTER_CREATION_OF_A_POST",
      linkedin: "LINKEDIN_CREATE_LINKED_IN_POST",
      facebook: "FACEBOOK_CREATE_POST",
      instagram: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
      tiktok: "TIKTOK_PUBLISH_VIDEO",
      youtube: "YOUTUBE_UPLOAD_VIDEO",
    });
  });
});

describe("publishSocialPostToProvider", () => {
  it("dispatches each provider to its adapter", async () => {
    const cases = [
      ["x", adapters.x],
      ["linkedin", adapters.linkedin],
      ["facebook", adapters.facebook],
      ["instagram", adapters.instagram],
      ["youtube", adapters.youtube],
      ["tiktok", adapters.tiktok],
    ] as const;

    for (const [provider, adapter] of cases) {
      adapter.mockResolvedValueOnce({
        externalId: `${provider}-1`,
        publishedUrl: null,
      });
      const input = context(provider);
      await expect(publishSocialPostToProvider(input)).resolves.toEqual({
        externalId: `${provider}-1`,
        publishedUrl: null,
      });
      expect(adapter).toHaveBeenCalledWith(input);
    }
  });

  it("rejects a provider that has no publisher yet", async () => {
    await expect(
      publishSocialPostToProvider(context("threads" as SocialPostProvider)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ComposioToolError &&
        error.message.includes("publishing is not available yet"),
    );
  });
});
