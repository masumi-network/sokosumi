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
      creator: {
        type: "orchestrator" as const,
        id: "orch-1",
        orchestrator: {
          id: "orch-1",
          name: "Hermes",
          slug: "hermes",
        },
      },
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
          orchestratorId: null,
          orchestrator: null,
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
          orchestratorId: null,
          orchestrator: null,
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
          userId: null,
          user: null,
          coworkerId: null,
          coworker: null,
          orchestratorId: "orch-2",
          orchestrator: {
            id: "orch-2",
            name: "Athena",
            slug: "athena",
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
    expect(result.orchestratorById).toMatchObject({
      "orch-1": {
        name: "Hermes",
        image: null,
      },
      "orch-2": {
        name: "Athena",
        image: null,
      },
    });
  });
});
