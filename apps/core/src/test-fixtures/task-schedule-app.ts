import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { ORG_WORKSPACE, userAuth } from "@/test-fixtures/task-schedule";

export function createTaskScheduleTestApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthenticationContext = userAuth(),
  workspaceContext: WorkspaceVariables["workspaceContext"] = ORG_WORKSPACE,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_task_schedule_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
