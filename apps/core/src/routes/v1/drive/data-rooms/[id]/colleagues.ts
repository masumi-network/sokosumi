import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomColleaguesSchema,
  setDataRoomColleaguesRequestSchema,
} from "@/schemas/data-room.schema";
import { setDataRoomColleagues } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/colleagues",
    description:
      "Choose which members of the organization may see and run an organization data room, besides its maker and the organization's owners and admins. Everyone else in the organization never sees the folder.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: setDataRoomColleaguesRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(dataRoomColleaguesSchema, "Colleagues let in"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });
    const colleagues = await setDataRoomColleagues({
      store,
      roomId: c.req.valid("param").id,
      userIds: body.userIds,
    });
    return ok(c, dataRoomColleaguesSchema.parse(colleagues));
  });
}
