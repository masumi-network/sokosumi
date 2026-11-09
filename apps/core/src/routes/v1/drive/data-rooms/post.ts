import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createDataRoomRequestSchema,
  dataRoomSchema,
  toDataRoomDto,
} from "@/schemas/data-room.schema";
import {
  createDataRoom,
  moveDataRoomFiles,
} from "@/services/data-room.service";

/** How long the request keeps moving files after it answers. */
const MOVE_AFTER_RESPONSE_MS = 60_000;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: [
      "Turn a Drive folder into a data room.",
      "Its files move to private storage, starting now; links to it or anything in it stop working.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: createDataRoomRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(dataRoomSchema, "Data room"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      503: jsonErrorResponse("Service Unavailable"),
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
    const room = await createDataRoom({
      store,
      folderPath: body.folderPath,
      userId: store.actor.userId,
    });
    // A small folder is private within the minute; the cron finishes the rest.
    const deadline = Date.now() + MOVE_AFTER_RESPONSE_MS;
    waitUntil(
      moveDataRoomFiles({ shouldContinue: () => Date.now() < deadline }).catch(
        (error: unknown) =>
          console.warn("[data-rooms] moving after create failed", {
            error: error instanceof Error ? error.message : "unknown",
          }),
      ),
    );
    return created(c, dataRoomSchema.parse(toDataRoomDto(room)));
  });
}
