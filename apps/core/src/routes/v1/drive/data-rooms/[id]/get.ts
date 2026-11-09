import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomDetailSchema,
  dataRoomStoreQuerySchema,
  toDataRoomDto,
  toDataRoomMemberDto,
  toDataRoomTreeRowDto,
} from "@/schemas/data-room.schema";
import {
  buildDataRoomTree,
  dataRoomOrder,
  listDataRoomFiles,
} from "@/services/data-room-files.service";
import {
  listDataRoomMembers,
  requireOwnedDataRoom,
} from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}",
    description:
      "One data room for its owner: settings, the people let in with what they opened, and its files in order.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      query: dataRoomStoreQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(dataRoomDetailSchema, "Data room"),
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
    const room = await requireOwnedDataRoom(store, c.req.valid("param").id);
    const [members, files, order] = await Promise.all([
      listDataRoomMembers(room),
      listDataRoomFiles(room),
      dataRoomOrder(room.id),
    ]);
    return ok(
      c,
      dataRoomDetailSchema.parse({
        room: toDataRoomDto(room),
        members: members.map(toDataRoomMemberDto),
        rows: buildDataRoomTree({ files, order }).map(toDataRoomTreeRowDto),
      }),
    );
  });
}
