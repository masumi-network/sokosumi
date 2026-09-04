import { createRoute, z } from "@hono/zod-openapi";
import {
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  resolveUserUploadContentType,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import {
  badRequest,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createChatRoomFileUploadSession } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  chatRoomFileUploadSessionSchema,
  createChatRoomFileUploadSessionRequestSchema,
} from "@/schemas/chat-room-file-upload.schema";

import {
  requireChatRoomCoworkerAccess,
  requireChatRoomOrchestratorAccess,
  requireChatRoomUserMembership,
} from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/files",
    description: [
      "Mint a direct upload session for a room chat attachment.",
      "Caller must be an active (non-archived) room member, either a user session or a coworker API key.",
      "Bytes go client to Vercel Blob (not through this API).",
      "Put the public Blob URL into message markdown. No ChatFile row.",
      "",
      "Paths:",
      "- User: `users/{userId}/chats/{roomId}/…`",
      "- Coworker: `coworkers/{coworkerId}/chats/{roomId}/…`",
      "",
      "Flow:",
      "1. POST this endpoint with `filename`, `contentType`, and `size`.",
      "2. PUT raw bytes to `data.uploadUrl` with `Content-Type` from `data.headers`.",
      "3. Insert the public URL into `POST …/messages` content.",
      "",
      `Max size: ${CHAT_ROOM_FILE_MAX_SIZE_BYTES} bytes. MIME allowlist matches user uploads.`,
    ].join("\n"),
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: createChatRoomFileUploadSessionRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        chatRoomFileUploadSessionSchema,
        "Room chat file upload session created",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      413: jsonErrorResponse("Payload Too Large"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: roomId } = c.req.valid("param");
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    if (body.size > CHAT_ROOM_FILE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${CHAT_ROOM_FILE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const resolvedContentType = resolveUserUploadContentType(
      body.filename,
      body.contentType,
    );
    if (!resolvedContentType) {
      throw badRequest(
        `Unsupported content type. Allowed types match user uploads (e.g. application/pdf, image/png, text/plain).`,
      );
    }

    const filename = body.filename.trim() || "file";

    if (isOrchestratorAuthContext(authContext)) {
      await requireChatRoomOrchestratorAccess(
        roomId,
        authContext.orchestratorId,
        prisma,
      );

      const session = await createChatRoomFileUploadSession(
        {
          kind: "orchestrator",
          orchestratorId: authContext.orchestratorId,
        },
        roomId,
        {
          filename,
          contentType: resolvedContentType,
          size: body.size,
          maxSizeBytes: CHAT_ROOM_FILE_MAX_SIZE_BYTES,
        },
        token,
      );

      return created(c, chatRoomFileUploadSessionSchema.parse(session));
    }

    if (isCoworkerAuthContext(authContext)) {
      await requireChatRoomCoworkerAccess(
        roomId,
        authContext.coworkerId,
        prisma,
      );

      const session = await createChatRoomFileUploadSession(
        { kind: "coworker", coworkerId: authContext.coworkerId },
        roomId,
        {
          filename,
          contentType: resolvedContentType,
          size: body.size,
          maxSizeBytes: CHAT_ROOM_FILE_MAX_SIZE_BYTES,
        },
        token,
      );

      return created(c, chatRoomFileUploadSessionSchema.parse(session));
    }

    const userContext = requireUserAuthContext(authContext);
    await requireChatRoomUserMembership(roomId, userContext.userId, prisma);

    const session = await createChatRoomFileUploadSession(
      { kind: "user", userId: userContext.userId },
      roomId,
      {
        filename,
        contentType: resolvedContentType,
        size: body.size,
        maxSizeBytes: CHAT_ROOM_FILE_MAX_SIZE_BYTES,
      },
      token,
    );

    return created(c, chatRoomFileUploadSessionSchema.parse(session));
  });
}
