import { createRoute, z } from "@hono/zod-openapi";
import {
  COWORKER_IMAGE_MAX_SIZE_BYTES,
  isCoworkerImageAllowedContentType,
  resolveUserUploadContentType,
  sniffImageMimeFromBytes,
} from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import {
  badRequest,
  notFound,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { deleteCoworkerImageIfOwned, uploadCoworkerImage } from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole } from "@/middleware/auth";
import { coworkerSchema } from "@/schemas/coworker.schema";

import {
  buildCoworkerMutationWhere,
  requireCoworkerManagementAccess,
} from "../../coworker-management-access";
import { paramsSchema } from "../schema";

/**
 * Multipart framing + field headers sit on top of the raw file. Cap the whole
 * request early (Content-Length / streaming) so oversized payloads never fully
 * buffer before the file.size check.
 */
const COWORKER_IMAGE_MAX_BODY_BYTES =
  COWORKER_IMAGE_MAX_SIZE_BYTES + 256 * 1024;

const multipartBodySchema = z.object({
  file: z.any().openapi({
    type: "string",
    format: "binary",
    description: "Coworker image file (png, jpeg, webp, or gif; max 2 MB)",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/image",
  description:
    "Upload a coworker image (admin or owner). Stores the file in Vercel Blob and sets coworker.image to the public URL. Replaces and deletes any previous owned image.",
  tags: ["Coworkers"],
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
    200: jsonSuccessResponse(coworkerSchema, "Upload coworker image"),
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
      maxSize: COWORKER_IMAGE_MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Request body is too large. Maximum file size is ${COWORKER_IMAGE_MAX_SIZE_BYTES} bytes.`,
        );
      },
    }),
  );

  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const userAuth = await requireCoworkerManagementAccess(
      c.var.authContext,
      id,
    );
    const mutationWhere = buildCoworkerMutationWhere(
      id,
      hasAdminRole(userAuth.role),
    );

    const body = await c.req.parseBody({ all: true });
    const fileField = body.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!isFileLike(file)) {
      throw badRequest("file is required");
    }

    if (file.size <= 0) {
      throw badRequest("file must not be empty");
    }

    if (file.size > COWORKER_IMAGE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${COWORKER_IMAGE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const declaredContentType =
      resolveUserUploadContentType(file.name, file.type) ??
      file.type.trim().toLowerCase();

    if (!isCoworkerImageAllowedContentType(declaredContentType)) {
      throw badRequest(
        "Unsupported content type. Allowed: image/png, image/jpeg, image/webp, image/gif.",
      );
    }

    const coworker = await prisma.coworker.findFirst({
      where: mutationWhere,
      select: {
        id: true,
        image: true,
      },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    const previousImage = coworker.image;
    const bytes = Buffer.from(await file.arrayBuffer());

    if (bytes.length > COWORKER_IMAGE_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${COWORKER_IMAGE_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const sniffedContentType = sniffImageMimeFromBytes(bytes);
    if (
      !sniffedContentType ||
      !isCoworkerImageAllowedContentType(sniffedContentType)
    ) {
      throw badRequest(
        "File content is not a supported image. Allowed: image/png, image/jpeg, image/webp, image/gif.",
      );
    }

    if (sniffedContentType !== declaredContentType) {
      throw badRequest(
        `File content type (${sniffedContentType}) does not match declared type (${declaredContentType}).`,
      );
    }

    const publicUrl = await uploadCoworkerImage({
      coworkerId: id,
      bytes,
      contentType: sniffedContentType,
      filename: file.name || "image",
    });

    if (!publicUrl) {
      throw serviceUnavailable(
        "Blob storage is not configured or upload failed",
      );
    }

    let updateResult: { count: number };
    try {
      updateResult = await prisma.coworker.updateMany({
        where: mutationWhere,
        data: { image: publicUrl },
      });
    } catch (error) {
      await deleteCoworkerImageIfOwned(publicUrl, id);
      throw error;
    }

    if (updateResult.count === 0) {
      await deleteCoworkerImageIfOwned(publicUrl, id);
      throw notFound("Coworker not found");
    }

    const updated = await prisma.coworker.findFirst({
      where: { id },
      include: coworkerInclude,
    });
    if (!updated) {
      throw notFound("Coworker not found");
    }

    await deleteCoworkerImageIfOwned(previousImage, id);

    return ok(c, mapCoworker(updated));
  });
}
