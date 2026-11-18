import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMoveTask from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { moveTaskMock } = vi.hoisted(() => ({ moveTaskMock: vi.fn() }));

vi.mock("@/helpers/task-subtask-move", () => ({ moveTask: moveTaskMock }));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (callback: (tx: unknown) => unknown) => callback({}),
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    return await next();
  });
  mountMoveTask(app);
  return app;
}

describe("POST /tasks/{id}/move", () => {
  it("returns 422 when neither parentTaskId nor afterTaskId is given", async () => {
    const response = await createApp().request("http://localhost/tsk_a/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    expect(moveTaskMock).not.toHaveBeenCalled();
  });
});
