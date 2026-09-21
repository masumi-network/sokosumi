import { describe, expect, it } from "vitest";

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

function idsOf(members: readonly ChatParticipantHoverProfile[]) {
  return members.map((member) => member.id);
}

describe("groupRosterMembers", () => {
  it("puts the viewer first among the people", () => {
    const { humans } = groupRosterMembers(
      [human("ada"), human(VIEWER_ID), human("zoe")],
      VIEWER_ID,
    );

    expect(idsOf(humans)).toEqual([VIEWER_ID, "ada", "zoe"]);
  });

  it("keeps everyone else in the order they arrived", () => {
    const { humans } = groupRosterMembers(
      [human("zoe"), human("ada"), human("mina")],
      VIEWER_ID,
    );

    // No viewer on this roster, and the panel does not re-sort people.
    expect(idsOf(humans)).toEqual(["zoe", "ada", "mina"]);
  });

  it("separates machines from people, Coworkers and Soko Bots together", () => {
    const { humans, agents } = groupRosterMembers(
      [human("ada"), coworker("elena"), human(VIEWER_ID), sokoBot("bot")],
      VIEWER_ID,
    );

    expect(idsOf(humans)).toEqual([VIEWER_ID, "ada"]);
    expect(idsOf(agents)).toEqual(["elena", "bot"]);
  });

  it("returns an empty half rather than inventing one", () => {
    const onlyAgents = groupRosterMembers([coworker("elena")], VIEWER_ID);
    expect(idsOf(onlyAgents.humans)).toEqual([]);
    expect(idsOf(onlyAgents.agents)).toEqual(["elena"]);

    const onlyPeople = groupRosterMembers([human("ada")], VIEWER_ID);
    expect(idsOf(onlyPeople.humans)).toEqual(["ada"]);
    expect(idsOf(onlyPeople.agents)).toEqual([]);
  });

  it("does not mutate the roster it was handed", () => {
    const roster = [human("ada"), human(VIEWER_ID)];

    groupRosterMembers(roster, VIEWER_ID);

    expect(idsOf(roster)).toEqual(["ada", VIEWER_ID]);
  });
});
