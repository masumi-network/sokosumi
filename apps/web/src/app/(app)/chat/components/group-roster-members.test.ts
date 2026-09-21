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
    const { humans } = groupRosterMembers(
      [human("ada"), human(VIEWER_ID), human("zoe")],
      VIEWER_ID,
      noReads,
    );

    expect(idsOf(humans)).toEqual([VIEWER_ID, "ada", "zoe"]);
  });

  it("keeps everyone else in the order they arrived", () => {
    const { humans } = groupRosterMembers(
      [human("zoe"), human("ada"), human("mina")],
      VIEWER_ID,
      noReads,
    );

    // No viewer on this roster, and the panel does not re-sort people.
    expect(idsOf(humans)).toEqual(["zoe", "ada", "mina"]);
  });

  it("separates machines from people, Coworkers and Soko Bots together", () => {
    const { humans, agents } = groupRosterMembers(
      [human("ada"), coworker("elena"), human(VIEWER_ID), sokoBot("bot")],
      VIEWER_ID,
      noReads,
    );

    expect(idsOf(humans)).toEqual([VIEWER_ID, "ada"]);
    expect(idsOf(agents)).toEqual(["elena", "bot"]);
  });

  it("returns an empty half rather than inventing one", () => {
    const onlyAgents = groupRosterMembers(
      [coworker("elena")],
      VIEWER_ID,
      noReads,
    );
    expect(idsOf(onlyAgents.humans)).toEqual([]);
    expect(idsOf(onlyAgents.agents)).toEqual(["elena"]);

    const onlyPeople = groupRosterMembers([human("ada")], VIEWER_ID, noReads);
    expect(idsOf(onlyPeople.humans)).toEqual(["ada"]);
    expect(idsOf(onlyPeople.agents)).toEqual([]);
  });

  it("orders the rest of the people by how recently they read", () => {
    const { humans } = groupRosterMembers(
      [human("stale"), human(VIEWER_ID), human("fresh"), human("never")],
      VIEWER_ID,
      readsOf({
        stale: "2026-01-01T10:00:00.000Z",
        fresh: "2026-01-01T12:00:00.000Z",
        // The viewer's own mark must not pull them out of first place.
        [VIEWER_ID]: "2026-01-01T09:00:00.000Z",
      }),
    );

    expect(idsOf(humans)).toEqual([VIEWER_ID, "fresh", "stale", "never"]);
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
