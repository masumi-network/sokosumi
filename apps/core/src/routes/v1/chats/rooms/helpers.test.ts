import { MemberRole } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildDirectCoworkerRoomKey,
  buildDirectParticipantRoomKey,
  buildDirectRoomKey,
  buildDirectRoomName,
  canManageChatRoomLifecycle,
  resolveMentionedCoworkerIds,
} from "./helpers";

const roomCoworkers = [
  { id: "coworker_elena", name: "Elena Research", slug: "elena" },
  { id: "coworker_hannah", name: "Hannah Ops", slug: "hannah" },
];

describe("resolveMentionedCoworkerIds", () => {
  it("resolves selected coworker IDs only when they belong to the room", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "Can someone check this?",
        explicitCoworkerIds: ["coworker_elena", "coworker_outside"],
        roomCoworkers,
      }),
    ).toEqual(["coworker_elena"]);
  });

  it("resolves coworker tokens and simple aliases from room coworkers", () => {
    expect(
      resolveMentionedCoworkerIds({
        content: "@coworker:hannah please sync with @elena",
        roomCoworkers,
      }),
    ).toEqual(["coworker_hannah", "coworker_elena"]);
  });
});

describe("buildDirectRoomKey", () => {
  it("builds the same key regardless of user order", () => {
    expect(buildDirectRoomKey("user_b", "user_a")).toBe("user_a:user_b");
    expect(buildDirectRoomKey("user_a", "user_b")).toBe("user_a:user_b");
  });

  it("builds a namespaced key for coworker direct messages", () => {
    expect(buildDirectCoworkerRoomKey("user_a", "coworker_elena")).toBe(
      "coworker:user_a:coworker_elena",
    );
  });

  it("builds stable keys for mixed participant direct messages", () => {
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: ["coworker_elena"],
      }),
    ).toBe("direct:v2:coworker:coworker_elena:user:user_a:user:user_b");
    expect(
      buildDirectParticipantRoomKey({
        currentUserId: "user_b",
        memberUserIds: ["user_a"],
        coworkerIds: [],
      }),
    ).toBe("user_a:user_b");
  });
});

describe("buildDirectRoomName", () => {
  it("formats short direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena"])).toBe("Andreas, Elena");
  });

  it("compacts long direct message names", () => {
    expect(buildDirectRoomName(["Andreas", "Elena", "Hannah", "Alex"])).toBe(
      "Andreas, Elena, Hannah and 1 more",
    );
  });
});

describe("canManageChatRoomLifecycle", () => {
  const creatorId = "user_creator";
  const otherId = "user_other";

  it("allows the channel creator regardless of org role", () => {
    expect(
      canManageChatRoomLifecycle({
        createdByUserId: creatorId,
        userId: creatorId,
        role: MemberRole.MEMBER,
      }),
    ).toBe(true);
  });

  it.each([
    ["owner", MemberRole.OWNER],
    ["admin", MemberRole.ADMIN],
  ] as const)(
    "allows an organization %s who is not the creator",
    (_label, role) => {
      expect(
        canManageChatRoomLifecycle({
          createdByUserId: creatorId,
          userId: otherId,
          role,
        }),
      ).toBe(true);
    },
  );

  it("denies a plain member who did not create the room", () => {
    expect(
      canManageChatRoomLifecycle({
        createdByUserId: creatorId,
        userId: otherId,
        role: MemberRole.MEMBER,
      }),
    ).toBe(false);
  });
});
