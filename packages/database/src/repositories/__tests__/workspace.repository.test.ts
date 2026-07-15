import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../../generated/prisma/client.js";
import { workspaceRepository } from "../workspace.repository.js";

describe("workspaceRepository", () => {
  it("returns the existing personal workspace when resolving a personal context", async () => {
    let findUniqueCall: unknown;
    let grantFindUniqueCall: unknown;
    const tx = {
      workspace: {
        findUnique: async (args: unknown) => {
          findUniqueCall = args;
          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-user-1",
            organizationId: null,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: "user-1",
          };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      vendorGrant: {
        findUnique: async (args: unknown) => {
          grantFindUniqueCall = args;
          return null;
        },
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      "user-1",
      null,
      tx,
    );

    assert.equal(workspace.id, "workspace-user-1");
    assert.deepEqual(findUniqueCall, {
      where: { userId: "user-1" },
    });
    assert.deepEqual(grantFindUniqueCall, {
      where: {
        vendorId_workspaceId: {
          vendorId: "01960001-0001-7001-8001-000000000001",
          workspaceId: "workspace-user-1",
        },
      },
      select: { id: true },
    });
  });

  it("creates the organization workspace when it is missing", async () => {
    let findUniqueCall: unknown;
    let createCall: unknown;
    let grantCreateCall: unknown;
    const tx = {
      workspace: {
        findUnique: async (args: unknown) => {
          findUniqueCall = args;
          return null;
        },
        create: async (args: unknown) => {
          createCall = args;
          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-org-1",
            organizationId: "org-1",
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: null,
          };
        },
      },
      vendorGrant: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          grantCreateCall = args;
          return { id: "grant-1" };
        },
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      "user-1",
      "org-1",
      tx,
    );

    assert.equal(workspace.id, "workspace-org-1");
    assert.deepEqual(findUniqueCall, {
      where: { organizationId: "org-1" },
    });
    assert.deepEqual(createCall, {
      data: { organizationId: "org-1" },
    });
    assert.deepEqual(grantCreateCall, {
      data: {
        vendorId: "01960001-0001-7001-8001-000000000001",
        workspaceId: "workspace-org-1",
        permission: "workspace",
        status: "GRANTED",
        resolvedAt: (grantCreateCall as { data: { resolvedAt: Date } }).data
          .resolvedAt,
        resolvedById: null,
      },
    });
  });

  it("re-reads the personal workspace after a unique race on create", async () => {
    let findUniqueCalls = 0;
    let grantFindUniqueCalls = 0;
    const tx = {
      workspace: {
        findUnique: async () => {
          findUniqueCalls += 1;
          if (findUniqueCalls === 1) {
            return null;
          }

          return {
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            id: "workspace-user-1",
            organizationId: null,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            userId: "user-1",
          };
        },
        create: async () => {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        },
      },
      vendorGrant: {
        findUnique: async () => {
          grantFindUniqueCalls += 1;
          return null;
        },
        create: async () => ({ id: "grant-1" }),
      },
      vendor: {
        findUnique: async () => ({
          id: "01960001-0001-7001-8001-000000000001",
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const workspace = await workspaceRepository.upsertWorkspaceForContext(
      "user-1",
      null,
      tx,
    );

    assert.equal(workspace.id, "workspace-user-1");
    assert.equal(findUniqueCalls, 2);
    assert.equal(grantFindUniqueCalls, 1);
  });
});
