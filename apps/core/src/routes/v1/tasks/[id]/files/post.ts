import { createRoute, z } from "@hono/zod-openapi";
import {
  resolveUserUploadContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";

import { requireTaskFileUploadAccess } from "@/helpers/access-control";
import {
  badRequest,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTaskFile } from "@/helpers/task";
import { deleteTaskFileIfOwned, uploadTaskFile } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  isUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { taskFileSchema } from "@/schemas/task-file.schema";
import { taskFileApiInclude } from "@/types/task";

const TASK_FILE_MAX_BODY_BYTES = TASK_FILE_MAX_SIZE_BYTES + 256 * 1024;

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const multipartBodySchema = z.object({
  file: z.any().openapi({
    type: "string",
    format: "binary",
    description: `Task file (max ${TASK_FILE_MAX_SIZE_BYTES} bytes; same MIME allowlist as user uploads)`,
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/files",
  description:
    "Upload a file for a task. Allowed for the task owner or the assigned coworker. Stores the file in public Vercel Blob storage and returns a public fileUrl.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: multipartBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskFileSchema, "Task file uploaded"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    413: jsonErrorResponse("Payload Too Large"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

function isFileLike(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).type === "string" &&
    typeof (value as File).name === "string"
  );
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/:id/files",
    bodyLimit({
      maxSize: TASK_FILE_MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Request body is too large. Maximum file size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
        );
      },
    }),
  );

  app.openapi(route, async (c) => {
    const { id: taskId } = c.req.valid("param");
    const { authContext } = c.var;

    await requireTaskFileUploadAccess(authContext, taskId);

    const body = await c.req.parseBody({ all: true });
    const fileField = body.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!isFileLike(file)) {
      throw badRequest("file is required");
    }

    if (file.size <= 0) {
      throw badRequest("file must not be empty");
    }

    if (file.size > TASK_FILE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const resolvedContentType = resolveUserUploadContentType(
      file.name,
      file.type,
    );
    if (!resolvedContentType) {
      throw badRequest(
        `Unsupported content type. Allowed types match user uploads (e.g. application/pdf, image/png, text/plain).`,
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > TASK_FILE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const publicUrl = await uploadTaskFile({
      taskId,
      bytes,
      contentType: resolvedContentType,
      filename: file.name || "file",
    });

    if (!publicUrl) {
      throw serviceUnavailable(
        "Blob storage is not configured or upload failed",
      );
    }

    const uploadedByUserId =
      isUserAuthContext(authContext) || isOrchestratorAuthContext(authContext)
        ? requireUserContext(authContext).userId
        : null;
    const uploadedByCoworkerId = isCoworkerAuthContext(authContext)
      ? authContext.coworkerId
      : null;

    try {
      const createdFile = await prisma.taskFile.create({
        data: {
          taskId,
          name: file.name || "file",
          fileUrl: publicUrl,
          mimeType: resolvedContentType,
          size: BigInt(bytes.length),
          uploadedByUserId,
          uploadedByCoworkerId,
        },
        include: taskFileApiInclude,
      });

      return created(c, taskFileSchema.parse(mapTaskFile(createdFile)));
    } catch (error) {
      await deleteTaskFileIfOwned(publicUrl, taskId);
      throw error;
    }
  });
}
