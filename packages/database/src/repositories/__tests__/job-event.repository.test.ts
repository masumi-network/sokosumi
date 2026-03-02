import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AgentJobStatus } from "../../generated/prisma/browser.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobEventRepository } from "../job-event.repository.js";

describe("jobEventRepository.createJobEventForJobId", () => {
  it("does not store inputSchemaHash when inputSchema is provided", async () => {
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

    const data = (createCall as { data: Record<string, unknown> }).data;
    assert.equal("inputSchemaHash" in data, false);
  });

  it("does not store inputSchemaHash when inputSchema is not provided", async () => {
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

    const data = (createCall as { data: Record<string, unknown> }).data;
    assert.equal("inputSchemaHash" in data, false);
  });
});
