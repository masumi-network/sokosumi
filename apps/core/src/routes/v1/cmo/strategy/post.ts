import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoStrategyRequestSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";

import { rethrow } from "../helpers";

export const config = {
  method: "post" as const,
  tags: ["CMO"],
  request: {
    body: {
      content: { "application/json": { schema: cmoStrategyRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      cmoTurnStartedSchema,
      "Cuso started planning the month",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("The Brand Brain is not ready yet"),
  },
};

const route = createRoute({
  ...config,
  path: "/strategy",
  operationId: "requestCmoStrategy",
});

export async function request(target: CusoTarget, note: string | undefined) {
  const started = await requestCmoStrategy({ ...target, note }).catch(rethrow);
  return cmoTurnStartedSchema.parse(started);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { note } = c.req.valid("json");
    return created(c, await request({ userId }, note));
  });
}
