import type { RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";

type EndpointSchemas = {
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response: z.ZodTypeAny;
};

export interface Endpoint<Schemas extends EndpointSchemas = EndpointSchemas> {
  schemas: Schemas;
  route: RouteConfig;
  handler: (c: Context) => Promise<Response> | Response;
}
