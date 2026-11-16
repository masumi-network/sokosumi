import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { createPaginationMeta } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  toDataRoomQuestionDto,
  waitingDataRoomQuestionSchema,
  waitingDataRoomQuestionsQuerySchema,
} from "@/schemas/data-room.schema";
import { dataRoomName } from "@/services/data-room-email.service";
import { listWaitingDataRoomQuestions } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/questions",
    description:
      "Unanswered viewer questions across the Drive's data rooms the caller may run, newest first (paginated; total counts them all).",
    tags: ["Drive"],
    request: { query: waitingDataRoomQuestionsQuerySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(waitingDataRoomQuestionSchema),
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
    const { count, questions, hasMore } = await listWaitingDataRoomQuestions(
      store,
      { cursor: query.cursor, take: query.limit },
    );
    const data = z.array(waitingDataRoomQuestionSchema).parse(
      questions.map((question) => ({
        ...toDataRoomQuestionDto(question),
        roomId: question.roomId,
        roomName: dataRoomName(question.room),
      })),
    );
    return ok(
      c,
      data,
      createPaginationMeta(data, count, query.limit, hasMore, query.cursor),
    );
  });
}
