import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { chatSignalLoopRequestSchema } from "@/schemas/chat-signal.schema";
import { setChatMessageSignalLoop } from "@/services/chat-signal-views.service";
import { messageParamsSchema } from "../../../params";
import { answerWithUpdatedMessage } from "../../updated-message";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/messages/{messageId}/loop",
    description:
      "Close or reopen a message's open loop (chat signals): a question or commitment made into a Task, dismissed, or brought back. A Task id must belong to the viewer's workspace. Answers with the message.",
    tags: ["Chat Signals"],
    request: {
      params: messageParamsSchema,
      body: {
        content: {
          "application/json": { schema: chatSignalLoopRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Updated message"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message has no signal, or Task not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { messageId } = c.req.valid("param");
    const body = c.req.valid("json");
    await setChatMessageSignalLoop({
      messageId,
      userId,
      workspaceId,
      closed: body.closed,
      taskId: body.taskId ?? null,
    });
    return ok(c, await answerWithUpdatedMessage(messageId, userId));
  });
}
