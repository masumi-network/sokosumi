import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

export function maintenanceMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    if (getEnv().MAINTENANCE_MODE) {
      throw serviceUnavailable("Service is under maintenance");
    }

    await next();
  };
}
