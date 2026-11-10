import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { dataRoomStoreQuerySchema } from "@/schemas/data-room.schema";
import { revokeDataRoomMember } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/members/{memberId}",
    description:
      "Take someone out of a data room at once. Their open sessions end on their next request; their history stays in the log.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid(), memberId: z.string().uuid() }),
      query: dataRoomStoreQuerySchema,
    },
    responses: {
      204: { description: "Access removed" },
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
    const { id, memberId } = c.req.valid("param");
    await revokeDataRoomMember({ store, roomId: id, memberId });
    return c.body(null, 204);
  });
}
