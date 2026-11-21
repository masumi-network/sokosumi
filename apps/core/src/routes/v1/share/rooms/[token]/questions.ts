import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import {
  askDataRoomQuestionRequestSchema,
  dataRoomViewerQuestionSchema,
  dataRoomViewerQuestionsSchema,
  toDataRoomViewerQuestionDto,
} from "@/schemas/data-room.schema";
import { findDataRoomFile } from "@/services/data-room-files.service";
import {
  askDataRoomQuestion,
  listViewerDataRoomQuestions,
} from "@/services/data-room-members.service";
import { requireDataRoomViewer } from "./viewer.js";

const listRoute = createRoute({
  method: "get",
  path: "/{token}/questions",
  description:
    "The viewer's own questions in the room and the answers the owner shared with everyone, never who else asked; about one document when resourceId is given.",
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    query: z.object({ resourceId: z.string().uuid().optional() }),
  },
  responses: {
    200: jsonSuccessResponse(dataRoomViewerQuestionsSchema, "Questions"),
    401: jsonErrorResponse("Not signed in"),
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
  },
});

const askRoute = createRoute({
  method: "post",
  path: "/{token}/questions",
  description:
    "Ask the room's owner a question about a document. The owner sees it in the room's questions.",
  tags: ["Share"],
  security: [],
  request: {
    params: z.object({ token: z.string().max(200) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: askDataRoomQuestionRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(dataRoomViewerQuestionSchema, "Question"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Not signed in"),
    404: jsonErrorResponse("Not Found"),
    410: jsonErrorResponse("Closed or expired"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(listRoute, async (c) => {
    const viewer = await requireDataRoomViewer(c, c.req.valid("param").token);
    const { resourceId } = c.req.valid("query");
    const file = resourceId
      ? await findDataRoomFile(viewer.room, resourceId)
      : null;
    const questions = await listViewerDataRoomQuestions({
      room: viewer.room,
      member: viewer.member,
      ...(file ? { path: file.path } : {}),
    });
    return ok(c, dataRoomViewerQuestionsSchema.parse(questions));
  });

  app.openapi(askRoute, async (c) => {
    const viewer = await requireDataRoomViewer(c, c.req.valid("param").token);
    const body = c.req.valid("json");
    const question = await askDataRoomQuestion({
      room: viewer.room,
      member: viewer.member,
      resourceId: body.resourceId,
      body: body.body,
    });
    return created(
      c,
      dataRoomViewerQuestionSchema.parse(
        toDataRoomViewerQuestionDto(question, viewer.member.id),
      ),
    );
  });
}
