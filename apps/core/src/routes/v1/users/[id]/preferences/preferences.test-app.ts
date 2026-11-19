import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import mountGetUserPreferences from "./get.js";
import mountPatchUserPreferences from "./patch.js";

export function createPreferencesApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(userByIdApp);
  mountGetUserPreferences(userByIdApp);
  mountPatchUserPreferences(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

export function patchRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
