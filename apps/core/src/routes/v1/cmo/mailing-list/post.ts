import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { getCmoHireForUser } from "@/services/cmo.service";
import { importCmoMailingList } from "@/services/cmo-mailing-list.service";

import { requireOverview } from "../helpers";

const route = createRoute({
  method: "post",
  path: "/mailing-list",
  operationId: "importCmoMailingList",
  tags: ["CMO"],
  description:
    "Adds the owner's mailing list (a CSV export, or one address a line) to the newsletter list Cuso writes for.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ text: z.string().min(1).max(2_000_000) }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Mailing list added"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    422: jsonErrorResponse("No email addresses found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { text } = c.req.valid("json");
    const hire = await getCmoHireForUser(userId);
    if (!hire) throw notFound("Cuso is not hired yet");
    await importCmoMailingList(hire, text);
    return ok(c, await requireOverview(userId));
  });
}
