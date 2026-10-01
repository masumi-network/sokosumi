import { Channel, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { mapTaskEvent } from "./task";

const owner = { id: "user_123", name: "Patrick", image: null };
const sokoBot = {
  id: "01960001-0001-7001-8001-000000000099",
  name: "Joseph",
  avatarSeed: "orb:jewel-sky:user_123",
  userId: owner.id,
  user: owner,
};

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof mapTaskEvent>[0] {
  return {
    id: "evt_123",
    taskId: "tsk_123",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    status: TaskStatus.READY,
    comment: "Proceed within 100 credits.",
    authenticationUrl: null,
    channel: Channel.SOKOSUMI,
    userId: null,
    coworkerId: null,
    sokoBotId: null,
    transactionId: null,
    cents: null,
    user: null,
    coworker: null,
    sokoBot: null,
    ...overrides,
  };
}

describe("mapTaskEvent on behalf of the owner", () => {
  const botEvent = () => event({ sokoBotId: sokoBot.id, sokoBot });

  it("gives a Coworker reader the bot owner's userId, actor unchanged", () => {
    const mapped = mapTaskEvent(botEvent(), { onBehalfOfOwner: true });
    expect(mapped.userId).toBe(owner.id);
    expect(mapped.actor).toMatchObject({ type: "sokoBot", id: sokoBot.id });
  });

  it("leaves bot events without a userId for everyone else", () => {
    expect(mapTaskEvent(botEvent()).userId).toBeNull();
  });

  it("leaves human events unchanged", () => {
    const human = event({
      userId: "user_456",
      user: { ...owner, id: "user_456" },
    });
    expect(mapTaskEvent(human, { onBehalfOfOwner: true })).toEqual(
      mapTaskEvent(human),
    );
  });
});
