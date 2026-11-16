import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomMemberSchema,
  toDataRoomMemberDto,
  updateDataRoomMemberRequestSchema,
} from "@/schemas/data-room.schema";
import { updateDataRoomMember } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/members/{memberId}",
    description:
      "Change one person's access to a data room: their name, when it ends, and which folders they see.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid(), memberId: z.string().uuid() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: updateDataRoomMemberRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(dataRoomMemberSchema, "Person"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { scope, organizationId, expiresAt, ...changes } =
      c.req.valid("json");
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope,
      organizationId,
    });
    const { id, memberId } = c.req.valid("param");
    const member = await updateDataRoomMember({
      store,
      roomId: id,
      memberId,
      ...changes,
      ...(expiresAt !== undefined
        ? { expiresAt: expiresAt ? new Date(expiresAt) : null }
        : {}),
    });
    return ok(c, dataRoomMemberSchema.parse(toDataRoomMemberDto({ member })));
  });
}
