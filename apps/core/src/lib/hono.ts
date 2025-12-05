import { OpenAPIHono } from "@hono/zod-openapi";

import { authMiddleware, type AuthVariables } from "@/middleware/auth";

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
  Variables: AuthVariables;
}> {
  constructor() {
    super();
    this.use(authMiddleware);
  }
}
