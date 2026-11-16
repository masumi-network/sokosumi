import { createRoute, z } from "@hono/zod-openapi";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { answerDataRoomQuestionRequestSchema } from "@/schemas/data-room.schema";
import { answerDataRoomQuestion } from "@/services/data-room-members.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/questions/{questionId}",
    description:
      "Answer a viewer's question. They see the answer beside the document.",
    tags: ["Drive"],
    request: {
      params: z.object({
        id: z.string().uuid(),
        questionId: z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          "application/json": { schema: answerDataRoomQuestionRequestSchema },
        },
      },
    },
    responses: {
      204: { description: "Answered" },
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });
    const { id, questionId } = c.req.valid("param");
    await answerDataRoomQuestion({
      store,
      roomId: id,
      questionId,
      answer: body.answer,
      userId: userContext.userId,
    });
    return c.body(null, 204);
  });
}
