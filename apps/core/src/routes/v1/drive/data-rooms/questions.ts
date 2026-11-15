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
  toDataRoomQuestionDto,
  waitingDataRoomQuestionsSchema,
} from "@/schemas/data-room.schema";
import { dataRoomName } from "@/services/data-room-email.service";
import { listWaitingDataRoomQuestions } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/questions",
    description:
      "Unanswered viewer questions across the Drive's data rooms the caller may run, newest first.",
    tags: ["Drive"],
    request: { query: dataRoomStoreQuerySchema },
    responses: {
      200: jsonSuccessResponse(
        waitingDataRoomQuestionsSchema,
        "Waiting questions",
      ),
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
    const { count, questions } = await listWaitingDataRoomQuestions(store);
    return ok(
      c,
      waitingDataRoomQuestionsSchema.parse({
        count,
        questions: questions.map((question) => ({
          ...toDataRoomQuestionDto(question),
          roomId: question.roomId,
          roomName: dataRoomName(question.room),
        })),
      }),
    );
  });
}
