import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { workspaceSummaryInclude } from "../../types/workspace.js";
import { workspaceRepository } from "../workspace.repository.js";

describe("workspaceRepository", () => {
  it("upserts the personal workspace when resolving a personal context", async () => {
    let upsertCall: unknown;
    const tx = {
      workspace: {
        upsert: async (args: unknown) => {
          upsertCall = args;
          return {
            id: "workspace-user-1",
            organization: null,
            organizationId: null,
            userId: "user-1",
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      "user-1",
      null,
      tx,
    );

    assert.equal(workspace.id, "workspace-user-1");
    assert.deepEqual(upsertCall, {
      where: { userId: "user-1" },
      update: {},
      create: { userId: "user-1" },
      include: workspaceSummaryInclude,
    });
  });

  it("upserts the organization workspace when resolving an organization context", async () => {
    let upsertCall: unknown;
    const tx = {
      workspace: {
        upsert: async (args: unknown) => {
          upsertCall = args;
          return {
            id: "workspace-org-1",
            organization: {
              id: "org-1",
              name: "Org One",
              slug: "org-one",
            },
            organizationId: "org-1",
            userId: null,
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      "user-1",
      "org-1",
      tx,
    );

    assert.equal(workspace.id, "workspace-org-1");
    assert.deepEqual(upsertCall, {
      where: { organizationId: "org-1" },
      update: {},
      create: { organizationId: "org-1" },
      include: workspaceSummaryInclude,
    });
  });
});
