import { createRoute, z } from "@hono/zod-openapi";
import {
  isOrchestratorImageAllowedContentType,
  ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES,
  resolveUserUploadContentType,
  sniffImageMimeFromBytes,
} from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";

import {
  badRequest,
  notFound,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { ok } from "@/helpers/response";
import {
  deleteOrchestratorImageIfOwned,
  uploadOrchestratorImage,
} from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

import { paramsSchema } from "../../schema";

/**
 * Multipart framing + field headers sit on top of the raw file. Cap the whole
 * request early (Content-Length / streaming) so oversized payloads never fully
 * buffer before the file.size check.
 */
const ORCHESTRATOR_IMAGE_MAX_BODY_BYTES =
  ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES + 256 * 1024;

const multipartBodySchema = z.object({
  file: z.any().openapi({
    type: "string",
    format: "binary",
    description: "Orchestrator image file (png, jpeg, webp, or gif; max 2 MB)",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/image",
  description:
    "Upload an orchestrator image (admin only). Stores the file in Vercel Blob and sets orchestrator.image to the public URL. Replaces and deletes any previous owned image.",
  tags: ["Orchestrators"],
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
    200: jsonSuccessResponse(orchestratorSchema, "Upload orchestrator image"),
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
    "/:id/image",
    bodyLimit({
      maxSize: ORCHESTRATOR_IMAGE_MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Request body is too large. Maximum file size is ${ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES} bytes.`,
        );
      },
    }),
  );

  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const body = await c.req.parseBody({ all: true });
    const fileField = body.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!isFileLike(file)) {
      throw badRequest("file is required");
    }

    if (file.size <= 0) {
      throw badRequest("file must not be empty");
    }

    if (file.size > ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const declaredContentType =
      resolveUserUploadContentType(file.name, file.type) ??
      file.type.trim().toLowerCase();

    if (!isOrchestratorImageAllowedContentType(declaredContentType)) {
      throw badRequest(
        "Unsupported content type. Allowed: image/png, image/jpeg, image/webp, image/gif.",
      );
    }

    const orchestrator = await prisma.orchestrator.findFirst({
      where: {
        id,
        archivedAt: null,
      },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    const previousImage = orchestrator.image;
    const bytes = Buffer.from(await file.arrayBuffer());

    if (bytes.length > ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const sniffedContentType = sniffImageMimeFromBytes(bytes);
    if (
      !sniffedContentType ||
      !isOrchestratorImageAllowedContentType(sniffedContentType)
    ) {
      throw badRequest(
        "File content is not a supported image. Allowed: image/png, image/jpeg, image/webp, image/gif.",
      );
    }

    // Prefer magic-byte type for storage; reject when it conflicts with the
    // declared type so a mislabeled payload cannot pass the allowlist alone.
    if (sniffedContentType !== declaredContentType) {
      throw badRequest(
        `File content type (${sniffedContentType}) does not match declared type (${declaredContentType}).`,
      );
    }

    const publicUrl = await uploadOrchestratorImage({
      orchestratorId: id,
      bytes,
      contentType: sniffedContentType,
      filename: file.name || "image",
    });

    if (!publicUrl) {
      throw serviceUnavailable(
        "Blob storage is not configured or upload failed",
      );
    }

    // Atomic with archivedAt so a concurrent archive cannot leave a new image
    // on an archived row (matches PATCH /orchestrators/{id}).
    let updateResult: { count: number };
    try {
      updateResult = await prisma.orchestrator.updateMany({
        where: {
          id,
          archivedAt: null,
        },
        data: { image: publicUrl },
      });
    } catch (error) {
      // Avoid orphaning the newly uploaded blob if the DB write fails.
      await deleteOrchestratorImageIfOwned(publicUrl, id);
      throw error;
    }

    if (updateResult.count === 0) {
      // Orchestrator was archived/deleted after the pre-check — drop the blob.
      await deleteOrchestratorImageIfOwned(publicUrl, id);
      throw notFound("Orchestrator not found");
    }

    const updated = await prisma.orchestrator.findFirst({
      where: { id },
    });
    if (!updated) {
      throw notFound("Orchestrator not found");
    }

    await deleteOrchestratorImageIfOwned(previousImage, id);

    return ok(c, mapOrchestrator(updated));
  });
}
