import { describe, expect, it } from "vitest";

import {
  buildDirectChannelKey,
  buildDirectChannelName,
  buildDirectCoworkerChannelKey,
  buildDirectParticipantChannelKey,
  resolveMentionedCoworkerIds,
} from "./helpers";

const channelCoworkers = [
  { id: "coworker_elena", name: "Elena Research", slug: "elena" },
  { id: "coworker_hannah", name: "Hannah Ops", slug: "hannah" },
];

describe("resolveMentionedCoworkerIds", () => {
  it("resolves selected coworker IDs only when they belong to the channel", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "Can someone check this?",
        explicitCoworkerIds: ["coworker_elena", "coworker_outside"],
        channelCoworkers,
      }),
    ).toEqual(["coworker_elena"]);
  });

  it("resolves coworker tokens and simple aliases from channel coworkers", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "@coworker:hannah please sync with @elena",
        channelCoworkers,
      }),
    ).toEqual(["coworker_hannah", "coworker_elena"]);
  });
});

describe("buildDirectChannelKey", () => {
  it("builds the same key regardless of user order", () => {
    expect(buildDirectChannelKey("user_b", "user_a")).toBe("user_a:user_b");
    expect(buildDirectChannelKey("user_a", "user_b")).toBe("user_a:user_b");
  });

  it("builds a namespaced key for coworker direct messages", () => {
    expect(buildDirectCoworkerChannelKey("user_a", "coworker_elena")).toBe(
      "coworker:user_a:coworker_elena",
    );
  });

  it("builds stable keys for mixed participant direct messages", () => {
    expect(
      buildDirectParticipantChannelKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: ["coworker_elena"],
      }),
    ).toBe("direct:v2:coworker:coworker_elena:user:user_a:user:user_b");
    expect(
      buildDirectParticipantChannelKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: [],
      }),
    ).toBe("user_a:user_b");
  });
});

describe("buildDirectChannelName", () => {
  it("formats short direct message names", () => {
    expect(buildDirectChannelName(["Andreas", "Elena"])).toBe("Andreas, Elena");
  });

  it("compacts long direct message names", () => {
    expect(buildDirectChannelName(["Andreas", "Elena", "Hannah", "Alex"])).toBe(
      "Andreas, Elena, Hannah and 1 more",
    );
  });
});
