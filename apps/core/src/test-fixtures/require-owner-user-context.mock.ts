import { HTTPException } from "hono/http-exception";

import type { AuthenticationContext, UserContext } from "@/middleware/auth";

/**
 * Test double for requireOwnerUserContext: reject coworker always;
 * allow session user.
 */
export function mockRequireOwnerUserContext(
  authContext: AuthenticationContext | null,
): UserContext {
  if (!authContext) {
    throw new HTTPException(403, {
      message: "User authentication required",
    });
  }
  if (authContext.actor === "coworker") {
    throw new HTTPException(403, {
      message: "Coworker authentication cannot perform this owner action",
    });
  }
  if (authContext.actor === "user") {
    return { source: "session" as const, ...authContext };
  }
  throw new HTTPException(403, {
    message: "User authentication required",
  });
}
