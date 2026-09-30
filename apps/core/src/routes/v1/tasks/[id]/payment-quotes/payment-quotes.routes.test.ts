import { type TaskMpsPaymentQuote, TaskStatus } from "@sokosumi/database";
import type { Context, Next } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden, unauthorized } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { requireTaskPaymentOwner } from "@/helpers/mps-payment-access";
import type { EnvVariables } from "@/lib/hono";
import type {
  AuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import { toTaskMpsPaymentQuoteDto } from "@/services/task-mps-payment-quote.service";

import taskRouter from "../../index";

const mocks = vi.hoisted(() => ({
  auth: null as AuthenticationContext | null,
  task: vi.fn(),
  membership: vi.fn(),
  workspace: vi.fn(),
  seat: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  approve: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findFirst: mocks.task },
    member: { findUnique: mocks.membership },
  },
}));
vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();
  return {
    ...actual,
    workspaceRepository: {
      ...actual.workspaceRepository,
      resolveWorkspaceForContext: mocks.workspace,
    },
  };
});
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: mocks.seat,
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (c: Context<EnvVariables>, next: Next) => {
      if (!mocks.auth) throw unauthorized();
      c.set("requestId", "quote-route-test");
      c.set("isAuthenticated", true);
      c.set("authContext", mocks.auth);
      await next();
    },
  };
});
vi.mock("@/services/task-mps-payment-quote.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/task-mps-payment-quote.service")
    >();
  return {
    ...actual,
    createTaskMpsPaymentQuote: mocks.create,
    getTaskMpsPaymentQuote: mocks.get,
    approveTaskMpsPaymentQuote: mocks.approve,
    revokeTaskMpsPaymentQuote: mocks.revoke,
  };
});

const owner: UserAuthenticationContext = {
  actor: "user",
  userId: "owner-1",
  organizationId: null,
  role: "user",
};
const task = {
  id: "task-1",
  ownerId: owner.userId,
  organizationId: "billing-org",
  assigneeId: "coworker-1",
  name: "Moved Task",
  description: "Task input",
  status: TaskStatus.READY,
  archivedAt: null,
  workspaceId: "destination-workspace",
};
const createInput = {
  idempotencyKey: "request-1",
  payByTime: "2030-01-01T01:00:00Z",
  submitResultTime: "2030-01-01T02:00:00Z",
  unlockTime: "2030-01-01T03:00:00Z",
  externalDisputeUnlockTime: "2030-01-01T04:00:00Z",
};
const approvalInput = { termsHash: "ab".repeat(32), maxCredits: 10 };
const now = new Date("2026-09-30T12:00:00Z");
const quote: TaskMpsPaymentQuote & {
  encryptedApiKey: string;
  clientResult: object;
} = {
  id: "quote-1",
  createdAt: now,
  updatedAt: now,
  taskId: task.id,
  sellerBindingId: "binding-1",
  coworkerId: task.assigneeId,
  billingOwnerId: owner.userId,
  billingOrganizationId: task.organizationId,
  network: "Preprod",
  idempotencyKey: createInput.idempotencyKey,
  inputHash: "ab".repeat(32),
  identifierFromPurchaser: "ab".repeat(10),
  requestPayload: { metadata: "private-request-metadata" },
  quotedTerms: {
    blockchainIdentifier: "signed-identifier",
    identifierFromPurchaser: "ab".repeat(10),
    agentIdentifier: "ab".repeat(32),
    sellerVkey: "cd".repeat(28),
    inputHash: "ab".repeat(32),
    Amounts: [{ unit: "", amount: "1000000" }],
    payByTime: String(Date.parse(createInput.payByTime)),
    submitResultTime: String(Date.parse(createInput.submitResultTime)),
    unlockTime: String(Date.parse(createInput.unlockTime)),
    externalDisputeUnlockTime: String(
      Date.parse(createInput.externalDisputeUnlockTime),
    ),
    paymentId: "payment-1",
    paymentSourceType: "Web3CardanoV1",
    smartContractAddress: "addr_test1_contract",
    sellerReturnAddress: null,
    metadata: "private-result-metadata",
    apiKey: "private-seller-key",
  },
  blockchainIdentifierHash: "cd".repeat(32),
  termsHash: approvalInput.termsHash,
  quotedCents: 100_000_000_000n,
  maxCents: null,
  expiresAt: new Date(createInput.payByTime),
  quotedAt: now,
  approvedByUserId: null,
  approvedAt: null,
  revokedAt: null,
  consumedAt: null,
  claimId: null,
  encryptedApiKey: "private-encrypted-key",
  clientResult: { debug: "private-client-result" },
};

function request(path: string, body?: object) {
  return taskRouter.request(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { ...owner };
  mocks.membership.mockResolvedValue({ id: "member-1" });
  mocks.workspace.mockImplementation(
    async (userId: string, organizationId: string | null) => ({
      id: organizationId ? "destination-workspace" : "personal-workspace",
      userId: organizationId ? null : userId,
      organizationId,
    }),
  );
  mocks.seat.mockResolvedValue(undefined);
  mocks.task.mockImplementation(
    async ({ where }: { where: { id?: string; ownerId?: string } }) =>
      where.id === task.id && where.ownerId === owner.userId ? task : null,
  );
  // Keep the service's actor/ownership boundary real. Service state and remote
  // calls are covered by its separate unit and database suites.
  const authorizedResult = async (
    auth: AuthenticationContext,
    taskId: string,
  ) => {
    await requireTaskPaymentOwner(auth, taskId);
    return toTaskMpsPaymentQuoteDto(quote);
  };
  mocks.create.mockImplementation(authorizedResult);
  mocks.get.mockImplementation(authorizedResult);
  mocks.approve.mockImplementation(authorizedResult);
  mocks.revoke.mockImplementation(authorizedResult);
  taskRouter.onError(errorHandler);
});

describe("Task MPS quote route contracts", () => {
  it("creates a quote with explicit deadlines", async () => {
    const response = await request(`/${task.id}/payment-quotes`, createInput);
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(owner, task.id, createInput);
  });

  it("reads one quote by Task and quote identity", async () => {
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(owner, task.id, quote.id);
  });

  it("passes the reviewed terms hash and credit ceiling for approval", async () => {
    const response = await request(
      `/${task.id}/payment-quotes/${quote.id}/approve`,
      approvalInput,
    );
    expect(response.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(
      owner,
      task.id,
      quote.id,
      approvalInput,
    );
  });

  it("revokes only the quote identity in the route", async () => {
    const response = await request(
      `/${task.id}/payment-quotes/${quote.id}/revoke`,
      {},
    );
    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(owner, task.id, quote.id);
  });

  it.each([
    "payByTime",
    "submitResultTime",
    "unlockTime",
    "externalDisputeUnlockTime",
  ] as const)("requires %s before creating a quote", async (field) => {
    const response = await request(`/${task.id}/payment-quotes`, {
      ...createInput,
      [field]: undefined,
    });
    expect(response.status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["not-a-date", "2030-02-30T00:00:00Z", "2030-01-01T01:00:00"])(
    "rejects invalid deadline %s",
    async (payByTime) => {
      const response = await request(`/${task.id}/payment-quotes`, {
        ...createInput,
        payByTime,
      });
      expect(response.status).toBe(422);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it.each(["", "ab".repeat(31), "AB".repeat(32), "zz".repeat(32)])(
    "rejects an invalid terms hash",
    async (termsHash) => {
      const response = await request(
        `/${task.id}/payment-quotes/${quote.id}/approve`,
        { ...approvalInput, termsHash },
      );
      expect(response.status).toBe(422);
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 922_337_204, "10", null, 1.00000000001, 0.00000000001])(
    "rejects invalid credit ceiling %s",
    async (maxCredits) => {
      const response = await request(
        `/${task.id}/payment-quotes/${quote.id}/approve`,
        { ...approvalInput, maxCredits },
      );
      expect(response.status).toBe(422);
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it("rejects caller-selected billing identity", async () => {
    const response = await request(
      `/${task.id}/payment-quotes/${quote.id}/approve`,
      { ...approvalInput, billingOrganizationId: "another-org" },
    );
    expect(response.status).toBe(422);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("returns the DTO without stored credentials or node metadata", async () => {
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("private-");
    const { data } = JSON.parse(text);
    expect(data).toMatchObject({
      paymentsEnabled: false,
      billingOrganizationId: "billing-org",
      state: "quoted",
    });
    for (const field of ["encryptedApiKey", "requestPayload", "clientResult"])
      expect(data).not.toHaveProperty(field);
    expect(data.terms).not.toHaveProperty("metadata");
    expect(data.terms).not.toHaveProperty("apiKey");
  });
});

describe("Task MPS quote access through the real Task router", () => {
  it("requires authentication on GET", async () => {
    mocks.auth = null;
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("rejects another human owner on GET", async () => {
    mocks.auth = { ...owner, userId: "other-user", role: "admin" };
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(404);
    expect(mocks.seat).not.toHaveBeenCalled();
  });

  it.each<AuthenticationContext>([
    { actor: "coworker", coworkerId: task.assigneeId, vendorId: "vendor-1" },
    {
      actor: "coworker",
      coworkerId: task.assigneeId,
      vendorId: "vendor-1",
      context: { userId: owner.userId, organizationId: task.organizationId },
    },
    {
      actor: "sokoBot",
      sokoBotId: "bot-1",
      userId: owner.userId,
      organizationId: null,
      workspaceId: task.workspaceId,
    },
  ])("rejects agent actor $actor on GET", async (auth) => {
    mocks.auth = auth;
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(403);
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("still requires eligibility in the original billing organization", async () => {
    mocks.seat.mockRejectedValue(forbidden("An assigned seat is required"));
    const response = await request(`/${task.id}/payment-quotes/${quote.id}`);
    expect(response.status).toBe(403);
    expect(mocks.seat).toHaveBeenCalledWith(
      owner.userId,
      task.organizationId,
      expect.anything(),
    );
  });

  it.each([
    { action: "create", path: `/${task.id}/payment-quotes`, body: createInput },
    {
      action: "read",
      path: `/${task.id}/payment-quotes/${quote.id}`,
      body: undefined,
    },
    {
      action: "approve",
      path: `/${task.id}/payment-quotes/${quote.id}/approve`,
      body: approvalInput,
    },
    {
      action: "revoke",
      path: `/${task.id}/payment-quotes/${quote.id}/revoke`,
      body: {},
    },
  ])(
    "allows $action after a Workspace move without a destination Seat",
    async ({ path, body }) => {
      mocks.auth = { ...owner, organizationId: "destination-org" };
      mocks.seat.mockImplementation(
        async (_userId: string, organizationId: string | null) => {
          if (organizationId === "destination-org")
            throw forbidden("An assigned seat is required");
        },
      );
      const response = await request(path, body);
      expect(response.status).toBe(200);
      expect(mocks.seat).toHaveBeenCalledTimes(1);
      expect(mocks.seat).toHaveBeenCalledWith(
        owner.userId,
        "billing-org",
        expect.anything(),
      );
    },
  );

  it("keeps the active organization Seat gate for ordinary Task reads", async () => {
    mocks.auth = { ...owner, organizationId: "destination-org" };
    mocks.seat.mockRejectedValue(forbidden("An assigned seat is required"));
    const response = await request(`/${task.id}`);
    expect(response.status).toBe(403);
    expect(mocks.seat).toHaveBeenCalledWith(owner.userId, "destination-org");
    expect(mocks.task).not.toHaveBeenCalled();
  });
});
