import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashInputSchema } from "@sokosumi/masumi/hash";

import { ScheduleType } from "../../generated/prisma/browser.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobScheduleRepository } from "../job-schedule.repository.js";

describe("jobScheduleRepository", () => {
  it("stores inputSchemaHash on create", async () => {
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
        scheduleType: ScheduleType.ONE_TIME,
        timezone: "UTC",
        inputSchema,
        input: JSON.stringify({ prompt: "hello" }),
        maxAcceptedCents: 1n,
      },
      tx,
    );

    const data = (createCall as { data: { inputSchemaHash: string } }).data;
    assert.equal(data.inputSchemaHash, hashInputSchema(inputSchema));
  });

  it("recomputes inputSchemaHash when inputSchema is updated", async () => {
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

    const data = (updateCall as { data: { inputSchemaHash: string } }).data;
    assert.equal(data.inputSchemaHash, hashInputSchema(inputSchema));
  });
});
