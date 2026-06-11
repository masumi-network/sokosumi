import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { lookupPendingInvitationById } from "@/helpers/invitation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getInvitationResultSchema } from "@/schemas/invitation.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Invitation ID (acts as the capability token for the link)",
    example: "inv_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description:
    "Resolve a pending invitation by id for the accept-invitation flow. Public: the id is the capability token, so the page works while logged out. Returns a discriminated result distinguishing not-found / expired / orphaned-inviter from a usable invitation.",
  tags: ["Invitations"],
  security: [],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      getInvitationResultSchema,
      "Resolve a pending invitation by id",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const result = await lookupPendingInvitationById(id);

    return ok(c, getInvitationResultSchema.parse(result));
  });
}
