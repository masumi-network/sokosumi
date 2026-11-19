import { describe, expect, it, vi } from "vitest";
import {
  addressCoworkers,
  createOrGetCoworkerQuestionRoom,
} from "./coworker-question-room";

const ELENA = { id: "cow_elena", name: "Elena", slug: "elena" };
const HANNAH = { id: "cow_hannah", name: "Hannah", slug: "hannah" };
const PARAMS = {
  organizationId: "org_1",
  memberUserId: "user_owner",
  sokoBotId: "bot_1",
  coworkers: [ELENA],
  discoverability: "private" as const,
};

function roster(room: {
  id: string;
  users: string[];
  coworkers: string[];
  bots?: string[];
}) {
  return {
    id: room.id,
    name: `Room ${room.id}`,
    userMembers: room.users.map((userId) => ({ userId })),
    coworkerMembers: room.coworkers.map((coworkerId) => ({ coworkerId })),
    sokoBotMembers: (room.bots ?? ["bot_1"]).map((sokoBotId) => ({
      sokoBotId,
    })),
  };
}

function client(candidates: ReturnType<typeof roster>[]) {
  const create = vi
    .fn()
    .mockResolvedValue({ id: "room_new", name: "Ask Elena" });
  const findMany = vi.fn().mockResolvedValue(candidates);
  return { tx: { chatRoom: { findMany, create } } as never, create, findMany };
}

describe("createOrGetCoworkerQuestionRoom", () => {
  it("reuses the room of exactly the owner, the bot and these Coworkers", async () => {
    const { tx, create } = client([
      roster({
        id: "room_wider",
        users: ["user_owner", "user_tom"],
        coworkers: ["cow_elena"],
      }),
      roster({
        id: "room_two",
        users: ["user_owner"],
        coworkers: ["cow_elena", "cow_hannah"],
      }),
      roster({
        id: "room_exact",
        users: ["user_owner"],
        coworkers: ["cow_elena"],
      }),
    ]);

    await expect(createOrGetCoworkerQuestionRoom(tx, PARAMS)).resolves.toEqual({
      id: "room_exact",
      name: "Room room_exact",
      created: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("opens a private channel when the owner widened the old one", async () => {
    // A teammate the owner added must not receive a question meant for them.
    const { tx, create } = client([
      roster({
        id: "room_wider",
        users: ["user_owner", "user_tom"],
        coworkers: ["cow_elena"],
      }),
    ]);

    await expect(
      createOrGetCoworkerQuestionRoom(tx, {
        ...PARAMS,
        coworkers: [ELENA, HANNAH],
      }),
    ).resolves.toMatchObject({ id: "room_new", created: true });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        createdByUserId: "user_owner",
        name: "Ask Elena, Hannah",
        slug: expect.stringMatching(/^ask-elena-hannah-[0-9a-f-]{36}$/),
        discoverability: "private",
        userMembers: { create: [{ userId: "user_owner", access: "member" }] },
        readStates: { create: [{ userId: "user_owner" }] },
        coworkerMembers: {
          create: [{ coworkerId: "cow_elena" }, { coworkerId: "cow_hannah" }],
        },
        sokoBotMembers: { create: [{ sokoBotId: "bot_1" }] },
      }),
      select: { id: true, name: true },
    });
  });
});

describe("addressCoworkers", () => {
  it("mentions each Coworker the question does not already address", () => {
    expect(
      addressCoworkers(
        "@elena can you two write this?",
        [ELENA, HANNAH],
        (coworker) => coworker.slug === "elena",
      ),
    ).toBe("@hannah @elena can you two write this?");
    expect(addressCoworkers("@elena hi", [ELENA], () => true)).toBe(
      "@elena hi",
    );
  });
});

describe("a shared bot's question room", () => {
  const SHARED = {
    ...PARAMS,
    memberUserId: "user_ada",
    discoverability: "public" as const,
  };

  it("is public, for the member who asked, and never a private room", async () => {
    const { tx, create, findMany } = client([]);

    await expect(
      createOrGetCoworkerQuestionRoom(tx, SHARED),
    ).resolves.toMatchObject({ id: "room_new", created: true });
    // Only public rooms are looked at, so a private one is never reused.
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizationId: "org_1",
      discoverability: "public",
      userMembers: { some: { userId: "user_ada" } },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        createdByUserId: "user_ada",
        discoverability: "public",
        userMembers: { create: [{ userId: "user_ada", access: "member" }] },
        coworkerMembers: { create: [{ coworkerId: "cow_elena" }] },
        sokoBotMembers: { create: [{ sokoBotId: "bot_1" }] },
      }),
      select: { id: true, name: true },
    });
  });

  it("continues the member's own conversation with the same Coworker", async () => {
    const { tx, create } = client([
      roster({
        id: "room_mine",
        users: ["user_ada"],
        coworkers: ["cow_elena"],
      }),
    ]);

    await expect(
      createOrGetCoworkerQuestionRoom(tx, SHARED),
    ).resolves.toMatchObject({ id: "room_mine", created: false });
    expect(create).not.toHaveBeenCalled();
  });
});
