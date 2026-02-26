import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { getEnv } from "@/config/env";

export function maintenanceMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    if (getEnv().MAINTENANCE_MODE) {
      return c.json(
        {
          error: "ServiceUnavailable",
          message: "Service is under maintenance",
          meta: {
            timestamp: new Date().toISOString(),
            requestId: c.var.requestId,
            path: c.req.path,
            method: c.req.method,
          },
        },
        503,
      );
    }

    await next();
  };
}
