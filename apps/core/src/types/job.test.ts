import type {
  JobWithListSummaryRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { flattenJob, serializeJobDetails } from "./job";

const person = (id: string) => ({ id, name: id, image: null });
const workspace = { id: "ws_1", organizationId: null, organization: null };

/** A Job row as the loaders return it, with only what the mappers read. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: null,
    agentId: "agent_1",
    ownerId: "user_owner",
    owner: person("user_owner"),
    creatorUserId: "user_owner",
    creatorUser: person("user_owner"),
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorSokoBotId: null,
    creatorSokoBot: null,
    organizationId: null,
    organization: null,
    projectId: null,
    taskId: null,
    name: "Job",
    jobType: "FREE",
    status: "PENDING",
    credits: null,
    purchase: null,
    result: null,
    resultHash: null,
    input: null,
    inputHash: null,
    inputSchema: null,
    jobStatusSettled: false,
    agent: { id: "agent_1", name: "Agent" },
    events: [],
    workspace,
    ...overrides,
  };
}

describe.each([
  [
    "flattenJob",
    (row: object) => flattenJob(row as unknown as JobWithListSummaryRelations),
  ],
  [
    "serializeJobDetails",
    (row: object) =>
      serializeJobDetails(row as unknown as JobWithSokosumiStatus),
  ],
])("%s Owner and Creator", (_name, serialize) => {
  it("names the Owner a Coworker made the Job for, and the Coworker as Creator", () => {
    const result = serialize(
      jobRow({
        creatorUserId: null,
        creatorUser: null,
        creatorCoworkerId: "cow_1",
        creatorCoworker: {
          id: "cow_1",
          name: "Cow",
          image: null,
          slug: "cow",
          vendorId: "vendor_1",
        },
      }),
    );

    expect(result).toMatchObject({
      ownerId: "user_owner",
      owner: { id: "user_owner" },
      creator: { type: "coworker", id: "cow_1" },
    });
  });

  it("returns a null Owner and Creator once the person who made it is deleted", () => {
    const result = serialize(
      jobRow({
        ownerId: null,
        owner: null,
        creatorUserId: null,
        creatorUser: null,
      }),
    );

    expect(result).toMatchObject({
      ownerId: null,
      owner: null,
      userId: null,
      user: null,
      creator: null,
    });
  });
});
