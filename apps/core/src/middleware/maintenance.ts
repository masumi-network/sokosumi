import type { MiddlewareHandler } from "hono";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

export function maintenanceMiddleware(): MiddlewareHandler {
  return async (_c, next) => {
    if (getEnv().MAINTENANCE_MODE) {
      throw serviceUnavailable("Service is under maintenance");
    }

    await next();
  };
}
