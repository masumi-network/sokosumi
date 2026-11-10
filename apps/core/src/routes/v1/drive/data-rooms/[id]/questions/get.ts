import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  dataRoomQuestionsSchema,
  dataRoomStoreQuerySchema,
  toDataRoomQuestionDto,
} from "@/schemas/data-room.schema";
import {
  listDataRoomQuestions,
  requireOwnedDataRoom,
} from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/questions",
    description:
      "Questions viewers asked about the room's documents, newest first.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      query: dataRoomStoreQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(dataRoomQuestionsSchema, "Questions"),
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
    const questions = await listDataRoomQuestions({ room });
    return ok(
      c,
      dataRoomQuestionsSchema.parse(questions.map(toDataRoomQuestionDto)),
    );
  });
}
