import { beforeEach, describe, expect, it, vi } from "vitest";

const composio = vi.hoisted(() => ({
  createSession: vi.fn(async () => "session-1"),
  execute: vi.fn(),
  deleteSession: vi.fn(async () => undefined),
}));
vi.mock("@/clients/social-post-providers/tools", () => ({
  createComposioToolSession: composio.createSession,
  executeComposioTool: composio.execute,
}));
vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: composio.deleteSession,
}));

import { listPostComments, replyToComment } from "./comments";

const context = (provider: "instagram" | "facebook" | "youtube") => ({
  provider,
  connectedAccountId: "ca-1",
  executorUserId: "exec-1",
  externalAccountId: "brand-1",
});

describe("listPostComments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads Instagram comments and leaves out the brand's own", async () => {
    composio.execute.mockResolvedValue({
      data: [
        {
          id: "c1",
          text: "Does it work offline?",
          username: "ana",
          timestamp: "2026-10-25T10:00:00+0000",
          from: { id: "u1", username: "ana" },
        },
        { id: "c2", text: "Thanks!", from: { id: "brand-1" } },
      ],
    });
    const comments = await listPostComments(context("instagram"), "m1");
    expect(composio.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "INSTAGRAM_GET_IG_MEDIA_COMMENTS",
        arguments: expect.objectContaining({ ig_media_id: "m1" }),
      }),
    );
    expect(comments).toEqual([
      {
        externalId: "c1",
        text: "Does it work offline?",
        authorName: "ana",
        authorExternalId: "u1",
        commentedAt: new Date("2026-10-25T10:00:00Z"),
      },
    ]);
    expect(composio.deleteSession).toHaveBeenCalled();
  });

  it("reads Facebook top-level comments by message", async () => {
    composio.execute.mockResolvedValue({
      data: [
        {
          id: "p_1",
          message: "Price?",
          created_time: "2026-10-25T10:00:00+0000",
          from: { id: "u2", name: "Ben" },
        },
      ],
    });
    const [comment] = await listPostComments(context("facebook"), "page_post");
    expect(comment).toMatchObject({ externalId: "p_1", authorName: "Ben" });
  });

  it("reads YouTube comment threads", async () => {
    composio.execute.mockResolvedValue({
      items: [
        {
          snippet: {
            topLevelComment: {
              id: "yt1",
              snippet: {
                textOriginal: "Great video",
                authorDisplayName: "Cleo",
                authorChannelId: { value: "chan-9" },
                publishedAt: "2026-10-25T10:00:00Z",
              },
            },
          },
        },
      ],
    });
    const [comment] = await listPostComments(context("youtube"), "vid");
    expect(comment).toMatchObject({
      externalId: "yt1",
      text: "Great video",
      authorExternalId: "chan-9",
    });
  });
});

describe("replyToComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      "instagram",
      "INSTAGRAM_POST_IG_COMMENT_REPLIES",
      { ig_comment_id: "c1", message: "Yes!" },
    ],
    [
      "facebook",
      "FACEBOOK_CREATE_COMMENT",
      { object_id: "c1", message: "Yes!" },
    ],
    [
      "youtube",
      "YOUTUBE_CREATE_COMMENT_REPLY",
      { parentId: "c1", textOriginal: "Yes!" },
    ],
  ] as const)(
    "replies on %s with its own tool",
    async (provider, toolSlug, args) => {
      composio.execute.mockResolvedValue({ id: "r1" });
      await expect(
        replyToComment(context(provider), "c1", "Yes!"),
      ).resolves.toBe("r1");
      expect(composio.execute).toHaveBeenCalledWith(
        expect.objectContaining({ toolSlug, arguments: args }),
      );
    },
  );
});
