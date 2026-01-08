import { OpenAPIHono } from "@hono/zod-openapi";

import { authMiddleware, type AuthVariables } from "@/middleware/auth";
import { organizationHeaderMiddleware } from "@/middleware/organization";

/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * Auth middleware is automatically applied - all routes are protected
 * Organization header middleware is also applied to set organizationId from X-Organization-Slug header
 * For mixed public/private routes, use standard OpenAPIHono class instead
 *
 * @example
 * const app = new OpenAPIHonoWithAuth();
 * // authMiddleware and organizationHeaderMiddleware are already applied
 */
export class OpenAPIHonoWithAuth extends OpenAPIHono<{
  Variables: AuthVariables;
}> {
  constructor() {
    super();
    this.use(authMiddleware);
    this.use(organizationHeaderMiddleware);
  }
}
