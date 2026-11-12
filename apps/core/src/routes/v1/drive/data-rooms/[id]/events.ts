import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { dataRoomEventsSchema } from "@/schemas/data-room.schema";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  listDataRoomEvents,
  requireOwnedDataRoom,
} from "@/services/data-room-members.service";

const PAGE = 100;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/events",
    description:
      "A data room's activity, newest first: who came in, and what they opened, downloaded and asked.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      query: z.object({
        scope: driveFileScopeSchema,
        organizationId: z.string().optional(),
        memberId: z.string().uuid().optional(),
        before: z.string().datetime().optional(),
      }),
    },
    responses: {
      200: jsonSuccessResponse(dataRoomEventsSchema, "Activity"),
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
    const events = await listDataRoomEvents({
      room,
      memberId: query.memberId,
      before: query.before ? new Date(query.before) : undefined,
      take: PAGE,
    });
    return ok(
      c,
      dataRoomEventsSchema.parse({
        events: events.map((event) => ({
          id: event.id,
          createdAt: event.createdAt.toISOString(),
          kind: event.kind.toLowerCase(),
          path: event.path,
          memberId: event.memberId,
          email: event.member?.email ?? null,
          name: event.member?.name ?? null,
        })),
        nextBefore:
          events.length === PAGE
            ? (events.at(-1)?.createdAt.toISOString() ?? null)
            : null,
      }),
    );
  });
}
