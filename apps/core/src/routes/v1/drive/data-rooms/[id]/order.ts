import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { setDataRoomOrderRequestSchema } from "@/schemas/data-room.schema";
import { setDataRoomOrder } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/order",
    description:
      "Set the order of a data room's folders and files, which also numbers them (1, 1.1, 1.2). Unlisted items follow, by name.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: {
        required: true,
        content: {
          "application/json": { schema: setDataRoomOrderRequestSchema },
        },
      },
    },
    responses: {
      204: { description: "Order saved" },
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
    await setDataRoomOrder({
      store,
      roomId: c.req.valid("param").id,
      entries: body.entries,
    });
    return c.body(null, 204);
  });
}
