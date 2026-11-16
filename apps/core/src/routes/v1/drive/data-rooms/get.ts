import { createRoute } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomStoreQuerySchema,
  dataRoomsSchema,
  toDataRoomDto,
} from "@/schemas/data-room.schema";
import { listDataRooms } from "@/services/data-room.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "The data rooms of a Drive: folders whose files are private.",
    tags: ["Drive"],
    request: { query: dataRoomStoreQuerySchema },
    responses: {
      200: jsonSuccessResponse(dataRoomsSchema, "Data rooms"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
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
    const rooms = await listDataRooms(store);
    return ok(c, dataRoomsSchema.parse(rooms.map(toDataRoomDto)));
  });
}
