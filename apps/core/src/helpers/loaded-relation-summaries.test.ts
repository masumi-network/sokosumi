import { describe, expect, it } from "vitest";

import {
  projectSummaryFromLoadedRelation,
  sokoBotSummaryFromLoadedRelation,
} from "./loaded-relation-summaries";

describe("projectSummaryFromLoadedRelation", () => {
  it("returns null when projectId is null", () => {
    expect(
      projectSummaryFromLoadedRelation("Task tsk_1", null, null),
    ).toBeNull();
  });

  it("maps a loaded project to id, name, identifier, and logo", () => {
    expect(
      projectSummaryFromLoadedRelation(
        "Task tsk_1",
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          name: "Autumn",
          identifier: "AUT",
          logo: "https://example.com/logo.png",
        },
      ),
    ).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      name: "Autumn",
      identifier: "AUT",
      logo: "https://example.com/logo.png",
    });
  });

  it("throws when projectId is set but the relation is missing", () => {
    expect(() =>
      projectSummaryFromLoadedRelation(
        "Task tsk_1",
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        null,
      ),
    ).toThrow(
      "Task tsk_1: project relation must be loaded for API mapping (projectId=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa).",
    );
  });
});

describe("sokoBotSummaryFromLoadedRelation", () => {
  const BOT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const bot = {
    id: BOT_ID,
    name: "Atlas",
    avatarSeed: null,
    avatarImageUrl: null,
    avatar: null,
  };
  const { avatar: _avatar, ...summary } = { ...bot, avatarStyleId: null };

  it("maps a personal bot with its owner", () => {
    expect(
      sokoBotSummaryFromLoadedRelation("Task tsk_1", BOT_ID, {
        ...bot,
        userId: "user_1",
        user: { id: "user_1", name: "Ana", image: null },
      }),
    ).toEqual({
      ...summary,
      owner: { id: "user_1", name: "Ana", image: null },
    });
  });

  it("names the style of the bot's claimed avatar, and none when it has none", () => {
    const crafted = sokoBotSummaryFromLoadedRelation("Task tsk_1", BOT_ID, {
      ...bot,
      avatar: { styleId: "crafted-desk" },
      userId: null,
      user: null,
    });
    const bare = sokoBotSummaryFromLoadedRelation("Task tsk_1", BOT_ID, {
      ...bot,
      userId: null,
      user: null,
    });

    expect(crafted?.avatarStyleId).toBe("crafted-desk");
    expect(bare?.avatarStyleId).toBeNull();
  });

  it("still throws when a personal bot's owner was not loaded", () => {
    expect(() =>
      sokoBotSummaryFromLoadedRelation("Task tsk_1", BOT_ID, {
        ...bot,
        userId: "user_1",
        user: null,
      }),
    ).toThrow("user relation must be loaded");
  });

  it("maps a shared bot with no owner instead of throwing", () => {
    expect(
      sokoBotSummaryFromLoadedRelation("Task tsk_1", BOT_ID, {
        ...bot,
        userId: null,
        user: null,
      }),
    ).toEqual({ ...summary, owner: null });
  });
});
