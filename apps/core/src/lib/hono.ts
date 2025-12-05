import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";

import { authMiddleware, type AuthVariables } from "@/middleware/auth";
import type { LanguageVariables } from "@/middleware/language";

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
  Variables: AuthVariables & RequestIdVariables & LanguageVariables;
}> {
  constructor() {
    super();
    this.use(authMiddleware);
  }
}
