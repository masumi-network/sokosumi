import type { RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";

export interface Endpoint<Schemas = Record<string, z.ZodTypeAny>> {
  schemas: Schemas;
  route: RouteConfig;
  handler: (c: Context) => Promise<Response> | Response;
  tags?: string[];
}
