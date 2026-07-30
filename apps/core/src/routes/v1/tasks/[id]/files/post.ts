import { createRoute, z } from "@hono/zod-openapi";
import {
  clampTaskFileName,
  resolveTaskFileContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { requireTaskFileUploadAccess } from "@/helpers/access-control";
import {
  badRequest,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createTaskFileUploadSession } from "@/lib/blob";
import {
  resolveBlobUploadCallbackUrl,
  TASK_FILE_UPLOAD_COMPLETED_PATH,
} from "@/lib/blob-callback-url";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  isUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import {
  createTaskFileUploadSessionRequestSchema,
  taskFileUploadSessionSchema,
} from "@/schemas/task-file-upload.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/files",
  description: [
    "Mint a direct upload session for a task file (owner or assigned coworker).",
    "Bytes go client → Vercel Blob (not through this API).",
    "When the Blob PUT completes, Core auto-creates the TaskFile row via",
    "`POST /v1/webhooks/tasks/files/uploaded` (Blob `onUploadCompleted` webhook).",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, and `size`.",
    "2. PUT raw bytes to `data.uploadUrl` with `Content-Type` from `data.headers`.",
    "3. Done — no register call. TaskFile appears via webhook; refresh the task if you need the row.",
    "",
    `Max size: ${TASK_FILE_MAX_SIZE_BYTES} bytes. MIME allowlist matches user uploads except image/svg+xml.`,
    "Requires public Core URL for the completion callback (production / tunnel).",
  ].join("\n"),
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createTaskFileUploadSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      taskFileUploadSessionSchema,
      "Task file upload session created",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    413: jsonErrorResponse("Payload Too Large"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: taskId } = c.req.valid("param");
    const { authContext } = c.var;

    await requireTaskFileUploadAccess(authContext, taskId);

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }
    if (!env.BLOB_WEBHOOK_PUBLIC_KEY) {
      throw serviceUnavailable(
        "Blob upload completion is not configured (BLOB_WEBHOOK_PUBLIC_KEY)",
      );
    }

    const body = c.req.valid("json");

    if (body.size > TASK_FILE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const resolvedContentType = resolveTaskFileContentType(
      body.filename,
      body.contentType,
    );
    if (!resolvedContentType) {
      throw badRequest(
        `Unsupported content type. Allowed types match user uploads except SVG (e.g. application/pdf, image/png, text/plain).`,
      );
    }

    const displayName = clampTaskFileName(body.filename || "file");

    const uploadedByUserId =
      isUserAuthContext(authContext) || isOrchestratorAuthContext(authContext)
        ? requireUserContext(authContext).userId
        : null;
    const uploadedByCoworkerId = isCoworkerAuthContext(authContext)
      ? authContext.coworkerId
      : null;

    const callbackUrl = resolveBlobUploadCallbackUrl(
      TASK_FILE_UPLOAD_COMPLETED_PATH,
    );

    const session = await createTaskFileUploadSession(
      taskId,
      {
        filename: displayName,
        contentType: resolvedContentType,
        size: body.size,
        maxSizeBytes: TASK_FILE_MAX_SIZE_BYTES,
      },
      token,
      {
        uploadedByUserId,
        uploadedByCoworkerId,
        callbackUrl,
      },
    );

    return created(c, taskFileUploadSessionSchema.parse(session));
  });
}
