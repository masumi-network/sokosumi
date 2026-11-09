import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSavedMessageMutationSchema } from "@/schemas/chat-room.schema";

import { savedMessageParamsSchema } from "./params";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{messageId}",
    description:
      "Remove a message from the reader's Saved list. Touches only the reader's own row, so it needs no room access. Idempotent.",
    tags: ["Chat Rooms"],
    request: { params: savedMessageParamsSchema },
    responses: {
      200: jsonSuccessResponse(chatSavedMessageMutationSchema, "Unsaved"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { messageId } = c.req.valid("param");

    await prisma.chatRoomSavedMessage.deleteMany({
      where: { userId, messageId },
    });

    return ok(
      c,
      chatSavedMessageMutationSchema.parse({ messageId, saved: false }),
    );
  });
}
