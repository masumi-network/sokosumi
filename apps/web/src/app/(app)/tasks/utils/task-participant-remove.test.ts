import { describe, expect, it } from "vitest";

import { canRemoveTaskParticipant } from "@/app/tasks/utils/task-participant-remove";

describe("canRemoveTaskParticipant", () => {
  it("allows the owner to remove any participant", () => {
    expect(
      canRemoveTaskParticipant({
        viewerId: "owner",
        ownerId: "owner",
        participantUserId: "other",
        viewerIsParticipant: false,
      }),
    ).toBe(true);
  });

  it("allows a participant to remove only themselves", () => {
    expect(
      canRemoveTaskParticipant({
        viewerId: "me",
        ownerId: "owner",
        participantUserId: "me",
        viewerIsParticipant: true,
      }),
    ).toBe(true);
    expect(
      canRemoveTaskParticipant({
        viewerId: "me",
        ownerId: "owner",
        participantUserId: "other",
        viewerIsParticipant: true,
      }),
    ).toBe(false);
  });

  it("forbids a non-owner non-participant", () => {
    expect(
      canRemoveTaskParticipant({
        viewerId: "viewer",
        ownerId: "owner",
        participantUserId: "other",
        viewerIsParticipant: false,
      }),
    ).toBe(false);
  });
});
