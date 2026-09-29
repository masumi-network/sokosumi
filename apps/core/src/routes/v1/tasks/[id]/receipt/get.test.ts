import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTaskSellerReceipt } from "@/helpers/coworker-task-receipt";
import { badGateway } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGetTaskReceipt from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/helpers/coworker-task-receipt", () => ({
  resolveTaskSellerReceipt: vi.fn(),
}));

const { taskFindFirstMock, coworkerFindFirstMock } = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

function createApp(actor: "user" | "coworker" = "user") {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    const authContext: AuthenticationContext =
      actor === "coworker"
        ? {
            actor: "coworker",
            coworkerId: "cow_123",
            vendorId: "01960001-0001-7001-8001-000000000001",
          }
        : {
            actor: "user",
            userId: "user_123",
            organizationId: "org_123",
            role: "user",
          };
    c.set("authContext", authContext);
    c.set(
      "workspaceContext",
      actor === "user"
        ? {
            workspaceId: testWorkspaceId,
            userId: "user_123",
            organizationId: "org_123",
          }
        : null,
    );
    return await next();
  });

  return app;
}

const settledReceipt = {
  blockchainIdentifier: "blockchain_abc",
  claimStatus: "PURCHASED",
  onChainState: "Withdrawn",
  settled: true,
  txHash: "0xseller_tx",
  withdrawnForSeller: [{ unit: "lovelace", amount: "1000000" }],
};

describe("GET /tasks/{id}/receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindFirstMock.mockResolvedValue({ id: "tsk_a", ownerId: "user_123" });
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_123" });
    vi.mocked(resolveTaskSellerReceipt).mockResolvedValue(settledReceipt);
  });

  it("returns the seller receipt to an authorized reader", async () => {
    const app = createApp();
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof settledReceipt };
    expect(body.data).toEqual(settledReceipt);
    // Settlement fields pass through the route untouched.
    expect(body.data.settled).toBe(true);
    expect(body.data.txHash).toBe("0xseller_tx");
    // The read gate ran against the task before the receipt resolved.
    expect(taskFindFirstMock).toHaveBeenCalledTimes(1);
    expect(resolveTaskSellerReceipt).toHaveBeenCalledWith(
      "tsk_a",
      expect.anything(),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("returns 404 when the caller cannot read the task", async () => {
    // requireTaskReadForRouteVars finds no readable task and throws notFound.
    taskFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(404);
    // The gate blocked before the settlement helper ran.
    expect(resolveTaskSellerReceipt).not.toHaveBeenCalled();
  });

  it("returns the seller receipt to the coworker assigned to the task", async () => {
    const app = createApp("coworker");
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof settledReceipt };
    expect(body.data).toEqual(settledReceipt);
    // The coworker gate scoped the task read to this coworker's assignment.
    expect(JSON.stringify(taskFindFirstMock.mock.calls[0][0])).toContain(
      "cow_123",
    );
  });

  it("returns 404 to a coworker that cannot read the task", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const app = createApp("coworker");
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(404);
    expect(resolveTaskSellerReceipt).not.toHaveBeenCalled();
  });

  it("returns 403 to a coworker without the tasks capability", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    const app = createApp("coworker");
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(403);
    expect(resolveTaskSellerReceipt).not.toHaveBeenCalled();
  });

  it("returns 502 when the payment node cannot resolve the receipt", async () => {
    vi.mocked(resolveTaskSellerReceipt).mockRejectedValue(
      badGateway("Could not resolve the task payment"),
    );

    const app = createApp();
    mountGetTaskReceipt(app);

    const response = await app.request("http://localhost/tsk_a/receipt");

    expect(response.status).toBe(502);
  });
});
