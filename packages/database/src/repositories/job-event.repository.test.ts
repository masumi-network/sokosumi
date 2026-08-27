import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { AgentJobStatus } from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import { jobEventRepository } from "./job-event.repository.js";

describe("jobEventRepository.createJobEventForJobId", () => {
  it("stores statusHash when provided", async () => {
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
        statusHash: "status-hash-1",
        inputSchema,
      },
      tx,
    );

    const data = (createCall as { data: Record<string, unknown> }).data;
    assert.equal(data.statusHash, "status-hash-1");
  });

  it("does not store statusHash when it is not provided", async () => {
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
    assert.equal(data.statusHash, undefined);
  });
});
