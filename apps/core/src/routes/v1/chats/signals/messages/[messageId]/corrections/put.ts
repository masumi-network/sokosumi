import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { chatSignalCorrectionRequestSchema } from "@/schemas/chat-signal.schema";
import { correctChatMessageSignal } from "@/services/chat-signal-views.service";
import { messageParamsSchema } from "../../../params";
import { answerWithUpdatedMessage } from "../../updated-message";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/messages/{messageId}/corrections",
    description:
      "Correct one tag on a tagged message (chat signals). The newest correction of a tag applies for every reader; Jev's own probability stays stored beside it as tuning data. Answers with the message.",
    tags: ["Chat Signals"],
    request: {
      params: messageParamsSchema,
      body: {
        content: {
          "application/json": { schema: chatSignalCorrectionRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Corrected message"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message has no signal"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { messageId } = c.req.valid("param");
    const body = c.req.valid("json");
    await correctChatMessageSignal({
      messageId,
      userId,
      tag: body.tag,
      applies: body.applies,
    });
    return ok(c, await answerWithUpdatedMessage(messageId, userId));
  });
}
