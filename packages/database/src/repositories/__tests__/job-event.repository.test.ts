import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashInputSchema } from "@sokosumi/masumi/hash";

import { AgentJobStatus } from "../../generated/prisma/browser.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobEventRepository } from "../job-event.repository.js";

describe("jobEventRepository.createJobEventForJobId", () => {
  it("stores inputSchemaHash when inputSchema is provided", async () => {
    const inputSchema = JSON.stringify([
      {
        id: "prompt",
        name: "Prompt",
        type: "string",
      },
    ]);
    let createCall: unknown;
    const tx = {
      jobEvent: {
        create: async (args: unknown) => {
          createCall = args;
          return {
            id: "event-1",
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobEventRepository.createJobEventForJobId(
      "job-1",
      {
        status: AgentJobStatus.INITIATED,
        inputSchema,
      },
      tx,
    );

    const data = (createCall as { data: { inputSchemaHash: string | null } })
      .data;
    assert.equal(data.inputSchemaHash, hashInputSchema(inputSchema));
  });

  it("stores null inputSchemaHash when inputSchema is not provided", async () => {
    let createCall: unknown;
    const tx = {
      jobEvent: {
        create: async (args: unknown) => {
          createCall = args;
          return {
            id: "event-1",
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobEventRepository.createJobEventForJobId(
      "job-1",
      {
        status: AgentJobStatus.RUNNING,
      },
      tx,
    );

    const data = (createCall as { data: { inputSchemaHash: string | null } })
      .data;
    assert.equal(data.inputSchemaHash, null);
  });
});
