import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { dataRoomStoreQuerySchema } from "@/schemas/data-room.schema";
import { closeDataRoom } from "@/services/data-room.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}",
    description:
      "Close a data room: its files move back to ordinary Drive storage and the folder becomes an ordinary folder.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      query: dataRoomStoreQuerySchema,
    },
    responses: {
      204: { description: "Data room closing" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const query = c.req.valid("query");
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    await closeDataRoom(store, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
