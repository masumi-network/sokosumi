import type { RouteConfig } from "@hono/zod-openapi";
import type { Context } from "hono";

export interface Endpoint<Schemas = Record<string, unknown>> {
  schemas: Schemas;
  route: RouteConfig;
  handler: (c: Context) => Promise<Response> | Response;
  tags?: string[];
}
