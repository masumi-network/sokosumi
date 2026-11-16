import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomSchema,
  toDataRoomDto,
  updateDataRoomRequestSchema,
} from "@/schemas/data-room.schema";
import { updateDataRoomSettings } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Change a data room's settings: title, welcome note, logo, allowed email domains, when it closes, downloads, watermark and first-visit notices.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: updateDataRoomRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(dataRoomSchema, "Data room"),
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
    const room = await updateDataRoomSettings({
      store,
      roomId: c.req.valid("param").id,
      ...changes,
      ...(expiresAt !== undefined
        ? { expiresAt: expiresAt ? new Date(expiresAt) : null }
        : {}),
    });
    return ok(c, dataRoomSchema.parse(toDataRoomDto(room)));
  });
}
