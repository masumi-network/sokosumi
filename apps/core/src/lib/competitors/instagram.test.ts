import { beforeEach, describe, expect, it, vi } from "vitest";

const composio = vi.hoisted(() => ({
  createComposioToolSession: vi.fn(),
  executeComposioTool: vi.fn(),
  deleteComposioToolSession: vi.fn(),
}));
vi.mock("@/clients/social-post-providers/tools", () => ({
  createComposioToolSession: composio.createComposioToolSession,
  executeComposioTool: composio.executeComposioTool,
}));
vi.mock("@/clients/composio.client", async (original) => ({
  ...(await original<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: composio.deleteComposioToolSession,
}));

import {
  instagramHandle,
  instagramWeek,
  readCompetitorInstagram,
} from "./instagram";

const now = new Date("2026-11-17T12:00:00Z");

function post(id: string, daysAgo: number, likes: number | null, comments = 0) {
  return {
    id,
    caption: `Caption ${id}`,
    media_type: "IMAGE",
    media_product_type: "FEED",
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    ...(likes === null ? {} : { like_count: likes }),
    comments_count: comments,
  };
}

describe("instagramWeek", () => {
  it("counts the week's posts and their average engagement", () => {
    const week = instagramWeek(
      "bluebottle",
      {
        followers_count: 511_000,
        media: {
          data: [
            post("a", 1, 100, 10),
            post("b", 3, 300, 30),
            post("c", 9, 900),
          ],
        },
      },
      now,
    );
    expect(week.followers).toBe(511_000);
    expect(week.postsThisWeek).toBe(2);
    expect(week.engagementPerPost).toBe(220);
  });

  it("ranks the top three posts of the last thirty days", () => {
    const week = instagramWeek(
      "bluebottle",
      {
        media: {
          data: [
            post("a", 2, 10),
            post("b", 12, 500),
            post("c", 20, 300),
            post("d", 25, 400),
            post("old", 45, 9_000),
          ],
        },
      },
      now,
    );
    expect(week.topPosts.map((item) => item.id)).toEqual(["b", "d", "c"]);
    expect(week.topPosts[0]).toMatchObject({
      url: "https://www.instagram.com/p/b/",
      caption: "Caption b",
      type: "FEED",
      likes: 500,
      comments: 0,
    });
  });

  it("counts a post with hidden likes and averages over the rest", () => {
    const hidden = { ...post("a", 1, null), comments_count: undefined };
    const week = instagramWeek(
      "bluebottle",
      { media: { data: [hidden, post("b", 2, 40, 2)] } },
      now,
    );
    expect(week.postsThisWeek).toBe(2);
    expect(week.engagementPerPost).toBe(42);
    expect(week.topPosts.map((item) => item.id)).toEqual(["b"]);
  });

  it("reads an account without posts or counts as empty", () => {
    expect(instagramWeek("bluebottle", {}, now)).toEqual({
      handle: "bluebottle",
      followers: null,
      postsThisWeek: 0,
      engagementPerPost: null,
      topPosts: [],
    });
  });
});

describe("instagramHandle", () => {
  it.each([
    ["@Blue.Bottle", "blue.bottle"],
    ["https://www.instagram.com/bluebottle/?hl=en", "bluebottle"],
    ["cal_com", "cal_com"],
  ])("reads %s as %s", (value, handle) => {
    expect(instagramHandle(value)).toBe(handle);
  });

  it.each(["", "blue bottle", "a){media", "x".repeat(31)])(
    "refuses %j",
    (value) => {
      expect(instagramHandle(value)).toBeNull();
    },
  );
});

describe("readCompetitorInstagram", () => {
  const reader = {
    composioConnectedAccountId: "ca_1",
    connectorUserId: "user-1",
    externalAccountId: "1789",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    composio.createComposioToolSession.mockResolvedValue("session-1");
  });

  it("asks the owner's account for the competitor and ends the session", async () => {
    composio.executeComposioTool.mockResolvedValue({
      business_discovery: { followers_count: 1200, media: { data: [] } },
    });
    const week = await readCompetitorInstagram({
      reader,
      handle: "@SavvyCal",
      now,
    });
    expect(week?.followers).toBe(1200);
    const call = composio.executeComposioTool.mock.calls[0]?.[0];
    expect(call.arguments.ig_user_id).toBe("1789");
    expect(call.arguments.fields).toContain(
      "business_discovery.username(savvycal){",
    );
    expect(composio.deleteComposioToolSession).toHaveBeenCalledWith(
      "session-1",
      "delete competitor Instagram session",
    );
  });

  it("is empty when Instagram has no business account for the handle", async () => {
    composio.executeComposioTool.mockResolvedValue({ id: "1789" });
    expect(
      await readCompetitorInstagram({ reader, handle: "savvycal", now }),
    ).toBeNull();
  });

  it("ends the session when the read fails", async () => {
    composio.executeComposioTool.mockRejectedValue(new Error("refused"));
    await expect(
      readCompetitorInstagram({ reader, handle: "savvycal", now }),
    ).rejects.toThrow("refused");
    expect(composio.deleteComposioToolSession).toHaveBeenCalledTimes(1);
  });

  it("never sends a handle that is not one", async () => {
    expect(
      await readCompetitorInstagram({ reader, handle: "a){media", now }),
    ).toBeNull();
    expect(composio.createComposioToolSession).not.toHaveBeenCalled();
  });
});
