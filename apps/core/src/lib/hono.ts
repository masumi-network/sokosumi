import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";

import { AuthContext } from "../middleware/auth";

/**
 * Type-safe Hono class with AuthContext in Variables
 * Use this for routes that require authentication
 *
 * @example
 * const router = new HonoWithAuthContext();
 */
export class HonoWithAuthContext extends Hono<{
  Variables: { auth: AuthContext };
}> {}

/**
 * Type-safe OpenAPIHono class with AuthContext in Variables
 * Use this for OpenAPI routes that require authentication
 *
 * @example
 * const app = new OpenAPIHonoWithAuthContext();
 */
export class OpenAPIHonoWithAuthContext extends OpenAPIHono<{
  Variables: { auth: AuthContext };
}> {}
