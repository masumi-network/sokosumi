import assert from "node:assert/strict";

import { beforeEach, describe, it } from "vitest";

import { SERVICEPLAN_VENDOR_ID } from "../../constants/vendor.js";
import {
  type Prisma,
  VendorGrantStatus,
  VendorPermission,
} from "../../generated/prisma/client.js";
import { vendorGrantRepository } from "../vendor-grant.repository.js";

describe("vendorGrantRepository", () => {
  beforeEach(() => {
    vendorGrantRepository.clearServiceplanGrantWorkspaceCacheForTests();
  });

  it("creates a granted Serviceplan workspace grant on first create", async () => {
    let createCall: unknown;

    const tx = {
      vendorGrant: {
        findUnique: async () => null,
        create: async (args: unknown) => {
          createCall = args;
          return { id: "grant-1" };
        },
      },
      vendor: {
        findUnique: async () => ({ id: SERVICEPLAN_VENDOR_ID }),
      },
    } as unknown as Prisma.TransactionClient;

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: "user-1",
      tx,
    });

    assert.deepEqual(createCall, {
      data: {
        vendorId: SERVICEPLAN_VENDOR_ID,
        workspaceId: "workspace-1",
        permission: VendorPermission.workspace,
        status: VendorGrantStatus.GRANTED,
        resolvedAt: (createCall as { data: { resolvedAt: Date } }).data
          .resolvedAt,
        resolvedById: "user-1",
      },
    });
    assert.ok(
      (createCall as { data: { resolvedAt: Date } }).data.resolvedAt instanceof
        Date,
    );
  });

  it("skips when a grant row already exists", async () => {
    const tx = {
      vendorGrant: {
        findUnique: async () => ({ id: "grant-1" }),
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      vendor: {
        findUnique: async () => {
          throw new Error("vendor lookup should not be called");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: "user-1",
      tx,
    });
  });

  it("skips when a revoked grant row already exists", async () => {
    let createCalls = 0;
    const tx = {
      vendorGrant: {
        findUnique: async () => ({
          id: "grant-revoked",
          status: VendorGrantStatus.REVOKED,
          permission: VendorPermission.workspace,
        }),
        create: async () => {
          createCalls += 1;
          return { id: "grant-new" };
        },
      },
      vendor: {
        findUnique: async () => {
          throw new Error("vendor lookup should not be called");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: "user-1",
      tx,
    });

    assert.equal(createCalls, 0);
  });

  it("skips duplicate in-process grant lookups for the same workspace", async () => {
    let findUniqueCalls = 0;
    const tx = {
      vendorGrant: {
        findUnique: async () => {
          findUniqueCalls += 1;
          return { id: "grant-1" };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      vendor: {
        findUnique: async () => {
          throw new Error("vendor lookup should not be called");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: "user-1",
      tx,
    });
    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: "user-1",
      tx,
    });

    assert.equal(findUniqueCalls, 1);
  });

  it("retries grant lookup when the Serviceplan vendor seed is missing", async () => {
    let findUniqueCalls = 0;
    const tx = {
      vendorGrant: {
        findUnique: async () => {
          findUniqueCalls += 1;
          return null;
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      vendor: {
        findUnique: async () => null,
      },
    } as unknown as Prisma.TransactionClient;

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: null,
      tx,
    });
    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: "workspace-1",
      resolvedByUserId: null,
      tx,
    });

    assert.equal(findUniqueCalls, 2);
  });
});
