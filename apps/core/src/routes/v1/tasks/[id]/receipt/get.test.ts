import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTaskSellerReceipt } from "@/helpers/coworker-task-receipt";
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

const { taskFindFirstMock } = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    const authContext: AuthenticationContext = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: testWorkspaceId,
      userId: "user_123",
      organizationId: "org_123",
    });
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
});
