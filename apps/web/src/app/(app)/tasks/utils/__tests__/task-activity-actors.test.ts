import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/clients/generated/core/types.gen";

import { buildTaskActivityActors } from "../task-activity-actors";

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
        id: "cow-1",
        name: "Ops Agent",
        image: "https://example.com/ops.png",
        slug: "ops-agent",
      },
      creatorUserId: "user-1",
      creatorUser: {
        id: "user-1",
        name: "Ada Lovelace",
        image: adaAvatar,
      },
      creatorCoworkerId: null,
      creatorCoworker: null,
      events: [
        {
          id: "evt-1",
          taskId: "task-1",
          createdAt: new Date("2026-01-01T12:00:00.000Z"),
          updatedAt: new Date("2026-01-01T12:00:00.000Z"),
          userId: "user-2",
          user: {
            id: "user-2",
            name: "Grace Hopper",
            image: null,
          },
          coworkerId: null,
          coworker: null,
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
          userId: null,
          user: null,
          coworkerId: "cow-2",
          coworker: {
            id: "cow-2",
            name: "Research Agent",
            image: null,
            slug: "research-agent",
          },
          transactionId: null,
          credits: null,
          comment: "Investigating",
          authenticationUrl: null,
          channel: "SOKOSUMI",
          origin: "SOKOSUMI",
          status: null,
        },
      ],
    } satisfies Pick<
      Task,
      | "owner"
      | "assignee"
      | "creatorUserId"
      | "creatorUser"
      | "creatorCoworkerId"
      | "creatorCoworker"
      | "events"
    >;

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
  });
});
