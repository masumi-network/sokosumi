import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { requestId, type RequestIdVariables } from "hono/request-id";

import { authMiddleware, type AuthVariables } from "@/middleware/auth";

/**
 * Type-safe Hono class with AuthContext in Variables
 * Use this for routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * For mixed public/private routes, use standard Hono class instead
 *
 * @example
 * const router = new HonoWithAuth();
 * // requireAuth middleware is already applied
 */
export class HonoWithAuth extends Hono<{
  Variables: AuthVariables & RequestIdVariables;
}> {
  constructor() {
    super();
    this.use(requestId());
    this.use(authMiddleware);
  }
}

/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * For mixed public/private routes, use standard OpenAPIHono class instead
 *
 * @example
 * const app = new OpenAPIHonoWithAuth();
 * // requireAuth middleware is already applied
 */
export class OpenAPIHonoWithAuth extends OpenAPIHono<{
  Variables: AuthVariables & RequestIdVariables;
}> {
  constructor() {
    super();
    this.use(requestId());
    this.use(authMiddleware);
  }
}
