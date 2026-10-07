import {
  type Task,
  type TaskEvent,
  TaskEventStatus,
  TaskStatus,
} from "@sokosumi/core-client";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { defaultOrbSeed } from "@/lib/aurora-orb";

import {
  buildTaskActivityActors,
  getEventActorInfo,
  resolveTaskEventActorKind,
} from "./task-activity-actors";

describe("resolveTaskEventActorKind", () => {
  it("prefers nested actor type over flat FKs", () => {
    const event = {
      actor: {
        type: "sokoBot",
        id: "orch-1",
        sokoBot: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: "orb:jewel-sky:user_123",
          avatarImageUrl: null,
        },
      },
      userId: "user-1",
      coworkerId: "cow-1",
      sokoBotId: "orch-1",
    } as TaskEvent;

    expect(resolveTaskEventActorKind(event)).toBe("sokoBot");
  });

  it("falls back to deprecated flat FKs when actor is null", () => {
    expect(
      resolveTaskEventActorKind({
        actor: null,
        coworkerId: "cow-1",
        userId: "user-1",
        sokoBotId: null,
      } as TaskEvent),
    ).toBe("coworker");
  });

  it("prefers soko bot over coworker/user on flat multi-FK fallback", () => {
    expect(
      resolveTaskEventActorKind({
        actor: null,
        coworkerId: "cow-1",
        userId: "user-1",
        sokoBotId: "orch-1",
      } as TaskEvent),
    ).toBe("sokoBot");
  });
});

describe("getEventActorInfo", () => {
  it("reads name and image from nested actor", () => {
    const event = {
      actor: {
        type: "user",
        id: "user-2",
        user: {
          id: "user-2",
          name: "Grace Hopper",
          image: "ipfs://bafygrace",
        },
      },
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Wrong User",
        image: null,
      },
    } as TaskEvent;

    expect(getEventActorInfo(event)).toEqual({
      name: "Grace Hopper",
      image: resolveIpfsOrHttpUrl("ipfs://bafygrace"),
    });
  });

  it("reads name, owner, and avatarSeed from nested soko bot actor", () => {
    const event = {
      actor: {
        type: "sokoBot",
        id: "orch-1",
        sokoBot: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: "orb:jewel-sky:user_123",
          avatarImageUrl: null,
          owner: {
            id: "user-1",
            name: "Ada Lovelace",
            image: null,
          },
        },
      },
    } as TaskEvent;

    expect(getEventActorInfo(event)).toEqual({
      name: "Hermes",
      image: null,
      avatarSeed: "orb:jewel-sky:user_123",
      ownerName: "Ada Lovelace",
    });
  });
});

describe("getEventActorInfo creation fallback", () => {
  const owner = { name: "Ada Lovelace", image: null };
  const userById = { "owner-1": owner };

  it("attributes an actorless creation event to the task owner", () => {
    const event = { status: TaskEventStatus.CREATED, actor: null } as TaskEvent;

    expect(
      getEventActorInfo(event, userById, undefined, undefined, "owner-1"),
    ).toEqual(owner);
  });

  it("keeps the event's own actor on a creation event", () => {
    const event = {
      status: TaskEventStatus.CREATED,
      actor: {
        type: "user",
        id: "user-2",
        user: { id: "user-2", name: "Grace Hopper", image: null },
      },
    } as TaskEvent;

    expect(
      getEventActorInfo(event, userById, undefined, undefined, "owner-1"),
    ).toEqual({ name: "Grace Hopper", image: null });
  });

  it("leaves other actorless events without an actor", () => {
    const event = { status: TaskStatus.RUNNING, actor: null } as TaskEvent;

    expect(
      getEventActorInfo(event, userById, undefined, undefined, "owner-1"),
    ).toBeUndefined();
  });
});

describe("buildTaskActivityActors", () => {
  it("builds actor maps from task and embedded event summaries", () => {
    const adaAvatar = "ipfs://bafyada";
    const task = {
      owner: {
        id: "user-1",
        name: "Ada Lovelace",
        image: adaAvatar,
      },
      assignee: {
        type: "coworker",
        id: "cow-1",
        coworker: {
          id: "cow-1",
          name: "Ops Agent",
          image: "https://example.com/ops.png",
          slug: "ops-agent",
        },
      },
      creator: {
        type: "sokoBot" as const,
        id: "orch-1",
        sokoBot: {
          id: "orch-1",
          name: "Hermes",
          avatarSeed: "orb:jewel-sky:user_123",
          avatarImageUrl: null,
          owner: {
            id: "user-1",
            name: "Ada Lovelace",
            image: null,
          },
        },
      },
      events: [
        {
          id: "evt-1",
          taskId: "task-1",
          createdAt: new Date("2026-01-01T12:00:00.000Z"),
          updatedAt: new Date("2026-01-01T12:00:00.000Z"),
          actor: {
            type: "user",
            id: "user-2",
            user: {
              id: "user-2",
              name: "Grace Hopper",
              image: null,
            },
          },
          userId: "user-2",
          user: {
            id: "user-2",
            name: "Grace Hopper",
            image: null,
          },
          coworkerId: null,
          coworker: null,
          sokoBotId: null,
          sokoBot: null,
          transactionId: null,
          credits: null,
          comment: "Looks good",
          authenticationUrl: null,
          channel: "SOKOSUMI",
          origin: "SOKOSUMI",
          status: null,
        },
        {
          id: "evt-2",
          taskId: "task-1",
          createdAt: new Date("2026-01-01T13:00:00.000Z"),
          updatedAt: new Date("2026-01-01T13:00:00.000Z"),
          actor: {
            type: "coworker",
            id: "cow-2",
            coworker: {
              id: "cow-2",
              name: "Research Agent",
              image: null,
              slug: "research-agent",
            },
          },
          userId: null,
          user: null,
          coworkerId: "cow-2",
          coworker: {
            id: "cow-2",
            name: "Research Agent",
            image: null,
            slug: "research-agent",
          },
          sokoBotId: null,
          sokoBot: null,
          transactionId: null,
          credits: null,
          comment: "Investigating",
          authenticationUrl: null,
          channel: "SOKOSUMI",
          origin: "SOKOSUMI",
          status: null,
        },
        {
          id: "evt-3",
          taskId: "task-1",
          createdAt: new Date("2026-01-01T14:00:00.000Z"),
          updatedAt: new Date("2026-01-01T14:00:00.000Z"),
          actor: {
            type: "sokoBot",
            id: "orch-2",
            sokoBot: {
              id: "orch-2",
              name: "Athena",
              avatarSeed: null,
              avatarImageUrl: null,
              owner: {
                id: "user-3",
                name: "Grace Hopper",
                image: null,
              },
            },
          },
          userId: null,
          user: null,
          coworkerId: null,
          coworker: null,
          sokoBotId: "orch-2",
          sokoBot: {
            id: "orch-2",
            name: "Athena",
            avatarSeed: null,
            avatarImageUrl: null,
            owner: {
              id: "user-3",
              name: "Grace Hopper",
              image: null,
            },
          },
          transactionId: null,
          credits: null,
          comment: null,
          authenticationUrl: null,
          channel: "SOKOSUMI",
          origin: "SOKOSUMI",
          status: "READY",
        },
      ],
    } satisfies Pick<Task, "owner" | "assignee" | "creator" | "events">;

    const result = buildTaskActivityActors(task);

    expect(result.userById).toMatchObject({
      "user-1": {
        name: "Ada Lovelace",
        image: resolveIpfsOrHttpUrl(adaAvatar),
      },
      "user-2": {
        name: "Grace Hopper",
        image: null,
      },
    });
    expect(result.coworkerById).toMatchObject({
      "cow-1": {
        name: "Ops Agent",
        image: "https://example.com/ops.png",
      },
      "cow-2": {
        name: "Research Agent",
        image: null,
      },
    });
    expect(result.sokoBotById).toMatchObject({
      "orch-1": {
        name: "Hermes",
        image: null,
        avatarSeed: "orb:jewel-sky:user_123",
        ownerName: "Ada Lovelace",
      },
      "orch-2": {
        name: "Athena",
        image: null,
        // No chosen seed: the same fallback the sidebar and the Soko Bots
        // page use, so one bot has one face across the product.
        avatarSeed: defaultOrbSeed("user-3"),
        ownerName: "Grace Hopper",
      },
    });
  });

  it("records a user assignee as a user actor (SOK-868)", () => {
    const task = {
      owner: { id: "user-1", name: "Ada Lovelace", image: null },
      assignee: {
        type: "user" as const,
        id: "user-2",
        user: { id: "user-2", name: "Bob", image: null },
      },
      creator: {
        type: "user" as const,
        id: "user-1",
        user: { id: "user-1", name: "Ada Lovelace", image: null },
      },
      events: [],
    } satisfies Pick<Task, "owner" | "assignee" | "creator" | "events">;

    const result = buildTaskActivityActors(task);

    expect(result.userById).toMatchObject({
      "user-2": { name: "Bob", image: null },
    });
    expect(result.coworkerById).toBeUndefined();
  });
});
