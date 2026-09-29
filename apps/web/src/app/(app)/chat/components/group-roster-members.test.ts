import { describe, expect, it } from "vitest";

import type { RoomMemberReadState } from "@/app/chat/hooks/use-room-read-receipts";

import { groupRosterMembers } from "./group-roster-members";
import type { ChatParticipantHoverProfile } from "./room-helpers";

const VIEWER_ID = "user-me";

function human(id: string): ChatParticipantHoverProfile {
  return {
    kind: "human",
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
  };
}

function coworker(id: string): ChatParticipantHoverProfile {
  return {
    kind: "coworker",
    id,
    name: id,
    slug: id,
    caption: null,
    image: null,
    presence: "online",
  };
}

function sokoBot(id: string): ChatParticipantHoverProfile {
  return {
    kind: "sokoBot",
    id,
    name: id,
    caption: null,
    image: null,
    avatarSeed: null,
    presence: "online",
  };
}

/** No read marks at all: grouping alone, order untouched. */
const noReads = { readStateFor: () => null };

function readsOf(marks: Record<string, string>): {
  readStateFor: (id: string) => RoomMemberReadState | null;
} {
  return {
    readStateFor: (id) =>
      marks[id] ? { kind: "read", lastReadAt: new Date(marks[id]) } : null,
  };
}

function idsOf(members: readonly ChatParticipantHoverProfile[]) {
  return members.map((member) => member.id);
}

describe("groupRosterMembers", () => {
  it("puts the viewer first among the people", () => {
    const { people } = groupRosterMembers(
      [human("ada"), human(VIEWER_ID), human("zoe")],
      VIEWER_ID,
      noReads,
    );

    expect(idsOf(people)).toEqual([VIEWER_ID, "ada", "zoe"]);
  });

  it("keeps everyone else in the order they arrived", () => {
    const { people } = groupRosterMembers(
      [human("zoe"), human("ada"), human("mina")],
      VIEWER_ID,
      noReads,
    );

    // No viewer on this roster, and the panel does not re-sort people.
    expect(idsOf(people)).toEqual(["zoe", "ada", "mina"]);
  });

  it("separates machines from people, Coworkers and Soko Bots together", () => {
    const { people, agents } = groupRosterMembers(
      [human("ada"), coworker("elena"), human(VIEWER_ID), sokoBot("bot")],
      VIEWER_ID,
      noReads,
    );

    expect(idsOf(people)).toEqual([VIEWER_ID, "ada"]);
    expect(idsOf(agents)).toEqual(["elena", "bot"]);
  });

  it("returns an empty half rather than inventing one", () => {
    const onlyAgents = groupRosterMembers(
      [coworker("elena")],
      VIEWER_ID,
      noReads,
    );
    expect(idsOf(onlyAgents.people)).toEqual([]);
    expect(idsOf(onlyAgents.agents)).toEqual(["elena"]);

    const onlyPeople = groupRosterMembers([human("ada")], VIEWER_ID, noReads);
    expect(idsOf(onlyPeople.people)).toEqual(["ada"]);
    expect(idsOf(onlyPeople.agents)).toEqual([]);
  });

  it("orders the rest of the people by how recently they read", () => {
    const { people } = groupRosterMembers(
      [human("stale"), human(VIEWER_ID), human("fresh")],
      VIEWER_ID,
      readsOf({
        stale: "2026-01-01T10:00:00.000Z",
        fresh: "2026-01-01T12:00:00.000Z",
        // The viewer's own mark must not pull them out of first place.
        [VIEWER_ID]: "2026-01-01T09:00:00.000Z",
      }),
    );
    // "never" has no mark at all, so it is not in the read order.

    expect(idsOf(people)).toEqual([VIEWER_ID, "fresh", "stale"]);
  });

  it("gathers the never-read at the end, out of the read order", () => {
    const { people, neverRead } = groupRosterMembers(
      [human("ada"), human("zoe"), human(VIEWER_ID)],
      VIEWER_ID,
      {
        readStateFor: (id) =>
          id === "ada"
            ? { kind: "read", lastReadAt: new Date("2026-01-01T10:00:00.000Z") }
            : id === "zoe"
              ? { kind: "unread" }
              : null,
      },
    );

    expect(idsOf(people)).toEqual([VIEWER_ID, "ada"]);
    expect(idsOf(neverRead)).toEqual(["zoe"]);
  });

  /**
   * What a guest sees: the receipts say nothing about anyone, which is not the
   * same as nobody having read. They get the plain roster back.
   */
  it("calls nobody never-read when the receipts are silent", () => {
    const { people, neverRead } = groupRosterMembers(
      [human("ada"), human("zoe")],
      VIEWER_ID,
      noReads,
    );

    expect(idsOf(people)).toEqual(["ada", "zoe"]);
    expect(neverRead).toEqual([]);
  });

  it("leaves machines in the order they arrived, having no mark to sort by", () => {
    const { agents } = groupRosterMembers(
      [coworker("zeta"), sokoBot("alpha"), coworker("mid")],
      VIEWER_ID,
      readsOf({ zeta: "2026-01-01T10:00:00.000Z" }),
    );

    expect(idsOf(agents)).toEqual(["zeta", "alpha", "mid"]);
  });

  it("does not mutate the roster it was handed", () => {
    const roster = [human("ada"), human(VIEWER_ID)];

    groupRosterMembers(roster, VIEWER_ID, noReads);

    expect(idsOf(roster)).toEqual(["ada", VIEWER_ID]);
  });
});
