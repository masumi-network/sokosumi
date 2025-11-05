import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";

import { AuthContext, requireAuth } from "../middleware/auth";

/**
 * Type-safe Hono class with AuthContext in Variables
 * Use this for routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * For mixed public/private routes, use standard Hono class instead
 *
 * @example
 * const router = new HonoWithAuthContext();
 * // requireAuth middleware is already applied
 */
export class HonoWithAuthContext extends Hono<{
  Variables: { auth: AuthContext };
}> {
  constructor() {
    super();
    this.use("*", requireAuth);
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
 * const app = new OpenAPIHonoWithAuthContext();
 * // requireAuth middleware is already applied
 */
export class OpenAPIHonoWithAuthContext extends OpenAPIHono<{
  Variables: { auth: AuthContext };
}> {
  constructor() {
    super();
    this.use("*", requireAuth);
  }
}
