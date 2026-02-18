import { createRoute, z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Delete task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Task deletion is temporarily disabled"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (_c) => {
    throw forbidden("Task deletion is temporarily disabled");
  });
}
