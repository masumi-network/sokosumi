import { type Prisma, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";

import { forbidden } from "./error";
import {
  requireMpsSellerAdmin,
  requireTaskPaymentOwner,
} from "./mps-payment-access";

const { defaultClient, seatCheck } = vi.hoisted(() => ({
  defaultClient: {
    coworker: { findFirst: vi.fn() },
    vendor: { findUnique: vi.fn() },
    vendorMember: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
  },
  seatCheck: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: defaultClient }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("./organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: seatCheck,
}));

const owner: UserAuthenticationContext = {
  actor: "user",
  userId: "owner-1",
  organizationId: "current-org",
  role: "user",
};

const agentActors: AuthenticationContext[] = [
  { actor: "coworker", coworkerId: "coworker-1", vendorId: "vendor-1" },
  {
    actor: "coworker",
    coworkerId: "coworker-1",
    vendorId: "vendor-1",
    context: { userId: owner.userId, organizationId: owner.organizationId },
  },
  {
    actor: "sokoBot",
    sokoBotId: "bot-1",
    userId: owner.userId,
    organizationId: owner.organizationId,
    workspaceId: "workspace-1",
  },
];

const task = {
  id: "task-1",
  ownerId: owner.userId,
  organizationId: "original-org",
  assigneeId: "coworker-1",
  name: "Review request",
  description: "Review the supplied document",
  status: TaskStatus.READY,
  archivedAt: null,
};

function createClient() {
  return {
    coworker: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: "coworker-1", vendorId: "vendor-1" }),
    },
    vendor: { findUnique: vi.fn().mockResolvedValue({ id: "vendor-1" }) },
    vendorMember: {
      findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }),
    },
    task: { findFirst: vi.fn().mockResolvedValue(task) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seatCheck.mockResolvedValue(undefined);
  defaultClient.coworker.findFirst.mockResolvedValue({
    id: "coworker-1",
    vendorId: "vendor-1",
  });
  defaultClient.vendor.findUnique.mockResolvedValue({ id: "vendor-1" });
  defaultClient.vendorMember.findFirst.mockResolvedValue({
    id: "membership-1",
  });
  defaultClient.task.findFirst.mockResolvedValue(task);
});

describe("requireMpsSellerAdmin", () => {
  it("requires an active coworker and admin membership in its vendor", async () => {
    const client = createClient();
    await expect(
      requireMpsSellerAdmin(
        owner,
        "coworker-1",
        client as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toEqual({ id: "coworker-1", vendorId: "vendor-1" });
    expect(client.coworker.findFirst).toHaveBeenCalledWith({
      where: { id: "coworker-1", archivedAt: null },
      select: { id: true, vendorId: true },
    });
    expect(client.vendorMember.findFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", userId: owner.userId, role: "admin" },
      select: { id: true },
    });
    expect(defaultClient.vendorMember.findFirst).not.toHaveBeenCalled();
  });

  it("uses the default client when no transaction is supplied", async () => {
    await expect(requireMpsSellerAdmin(owner, "coworker-1")).resolves.toEqual({
      id: "coworker-1",
      vendorId: "vendor-1",
    });
  });

  it.each(agentActors)(
    "rejects agent actor $actor before any lookup",
    async (auth) => {
      await expect(
        requireMpsSellerAdmin(auth, "coworker-1"),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(defaultClient.coworker.findFirst).not.toHaveBeenCalled();
    },
  );

  it("rejects missing or archived coworkers", async () => {
    defaultClient.coworker.findFirst.mockResolvedValue(null);
    await expect(
      requireMpsSellerAdmin(owner, "coworker-1"),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(defaultClient.vendorMember.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    "assignment-only developer",
    "admin of another vendor",
    "removed admin",
  ])("rejects a %s without current membership in this vendor", async () => {
    defaultClient.vendorMember.findFirst.mockResolvedValue(null);
    await expect(
      requireMpsSellerAdmin(owner, "coworker-1"),
    ).rejects.toMatchObject({
      status: 403,
      message: "Vendor admin access required",
    });
  });

  it("does not grant platform admins an exemption from vendor membership", async () => {
    defaultClient.vendorMember.findFirst.mockResolvedValue(null);
    await expect(
      requireMpsSellerAdmin({ ...owner, role: "admin" }, "coworker-1"),
    ).rejects.toMatchObject({ status: 403 });
    expect(defaultClient.vendorMember.findFirst).toHaveBeenCalled();
  });
});

describe("requireTaskPaymentOwner", () => {
  it("uses the original billing organization after a workspace move", async () => {
    const client = createClient();
    const tx = client as unknown as Prisma.TransactionClient;
    await expect(requireTaskPaymentOwner(owner, task.id, tx)).resolves.toEqual(
      task,
    );
    expect(client.task.findFirst).toHaveBeenCalledWith({
      where: { id: task.id, ownerId: owner.userId, archivedAt: null },
    });
    expect(seatCheck).toHaveBeenCalledWith(owner.userId, "original-org", tx);
    expect(defaultClient.task.findFirst).not.toHaveBeenCalled();
  });

  it("allows personal billing even when the active organization differs", async () => {
    defaultClient.task.findFirst.mockResolvedValue({
      ...task,
      organizationId: null,
    });
    await expect(
      requireTaskPaymentOwner(owner, task.id),
    ).resolves.toMatchObject({
      organizationId: null,
    });
    expect(seatCheck).toHaveBeenCalledWith(owner.userId, null, defaultClient);
  });

  it.each(["session", "api_key", "oauth"] as const)(
    "accepts owner %s credentials without requiring an organization admin role",
    async (authenticationMethod) => {
      await expect(
        requireTaskPaymentOwner({ ...owner, authenticationMethod }, task.id),
      ).resolves.toEqual(task);
    },
  );

  it.each(agentActors)(
    "rejects agent actor $actor before any lookup",
    async (auth) => {
      await expect(
        requireTaskPaymentOwner(auth, task.id),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(defaultClient.task.findFirst).not.toHaveBeenCalled();
      expect(seatCheck).not.toHaveBeenCalled();
    },
  );

  it.each(["another owner", "an archived task", "a missing task"])(
    "rejects %s through the ownership guard",
    async () => {
      defaultClient.task.findFirst.mockResolvedValue(null);
      await expect(
        requireTaskPaymentOwner(owner, task.id),
      ).rejects.toMatchObject({
        status: 404,
      });
      expect(seatCheck).not.toHaveBeenCalled();
    },
  );

  it("does not use organization admin status as ownership", async () => {
    defaultClient.task.findFirst.mockResolvedValue(null);
    await expect(
      requireTaskPaymentOwner(
        { ...owner, userId: "other-admin", role: "admin" },
        task.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(defaultClient.task.findFirst).toHaveBeenCalledWith({
      where: { id: task.id, ownerId: "other-admin", archivedAt: null },
    });
  });

  it.each(["removed organization membership", "missing required Seat"])(
    "rejects %s in the billing organization",
    async () => {
      seatCheck.mockRejectedValue(forbidden("An assigned seat is required"));
      await expect(
        requireTaskPaymentOwner(owner, task.id),
      ).rejects.toMatchObject({
        status: 403,
      });
    },
  );

  it("requires a Coworker assignment", async () => {
    defaultClient.task.findFirst.mockResolvedValue({
      ...task,
      assigneeId: null,
    });
    await expect(requireTaskPaymentOwner(owner, task.id)).rejects.toMatchObject(
      {
        status: 422,
        message: "Task must be assigned to a coworker",
      },
    );
    expect(seatCheck).not.toHaveBeenCalled();
  });
});
