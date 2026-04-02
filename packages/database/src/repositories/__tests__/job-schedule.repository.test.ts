import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { ScheduleType } from "../../generated/prisma/browser.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobScheduleRepository } from "../job-schedule.repository.js";

describe("jobScheduleRepository", () => {
  it("does not store inputSchemaHash on create", async () => {
    const inputSchema = JSON.stringify([
      {
        id: "prompt",
        name: "Prompt",
        type: "string",
      },
    ]);
    let createCall: unknown;
    const tx = {
      jobSchedule: {
        create: async (args: unknown) => {
          createCall = args;
          return {
            id: "schedule-1",
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobScheduleRepository.create(
      {
        user: {
          connect: {
            id: "user-1",
          },
        },
        agent: {
          connect: {
            id: "agent-1",
          },
        },
        workspace: {
          connect: {
            id: "11111111-1111-7111-8111-111111111111",
          },
        },
        scheduleType: ScheduleType.ONE_TIME,
        timezone: "UTC",
        inputSchema,
        input: JSON.stringify({ prompt: "hello" }),
        maxAcceptedCents: 1n,
      },
      tx,
    );

    const data = (createCall as { data: Record<string, unknown> }).data;
    assert.equal("inputSchemaHash" in data, false);
  });

  it("does not write inputSchemaHash when inputSchema is updated", async () => {
    const inputSchema = JSON.stringify([
      {
        id: "prompt",
        name: "Prompt",
        type: "string",
      },
    ]);
    let updateCall: unknown;
    const tx = {
      jobSchedule: {
        update: async (args: unknown) => {
          updateCall = args;
          return {
            id: "schedule-1",
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobScheduleRepository.update(
      "schedule-1",
      {
        inputSchema,
      },
      tx,
    );

    const data = (updateCall as { data: Record<string, unknown> }).data;
    assert.equal("inputSchemaHash" in data, false);
  });

  it("filters schedule lists by user within the active workspace", async () => {
    let findManyCall: unknown;
    const tx = {
      jobSchedule: {
        findMany: async (args: unknown) => {
          findManyCall = args;
          return [];
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobScheduleRepository.getScheduleJobsByContext(
      "user-1",
      "11111111-1111-7111-8111-111111111111",
      tx,
    );

    assert.deepEqual(findManyCall, {
      where: {
        userId: "user-1",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      orderBy: { updatedAt: "desc" },
      include: {
        agent: true,
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
  });
});
