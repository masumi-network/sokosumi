import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderMarkerPathname,
  buildUserDriveFolderMarkerPathname,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import {
  badRequest,
  conflict,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { createDriveFolderRequestSchema } from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: [
    "Create an empty Drive folder by writing a folder marker blob.",
    "The folder appears in the parent list immediately, even when empty.",
    "Personal: owner only. Organization: any member.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createDriveFolderRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      createDriveFolderRequestSchema,
      "Folder created (marker written)",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - folder already exists"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const body = c.req.valid("json");

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const folderPath = normalizeDriveFolderPath(body.folderPath);
    if (!folderPath) {
      throw badRequest("Folder path cannot be empty");
    }

    let markerPathname: string;

    if (body.scope === "me") {
      const ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
      markerPathname = buildUserDriveFolderMarkerPathname(ownerId, folderPath);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      const ownerId = body.organizationId;
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId);
      markerPathname = buildOrganizationDriveFolderMarkerPathname(
        ownerId,
        folderPath,
      );
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Check if marker already exists
    try {
      await head(markerPathname, { token });
      // Marker exists
      throw conflict("Folder already exists");
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        // Marker doesn't exist, proceed
      } else if (
        error &&
        typeof error === "object" &&
        "kind" in error &&
        error.kind === "conflict"
      ) {
        throw error;
      } else {
        throw error;
      }
    }

    // Write the marker (one-byte blob; @vercel/blob requires non-empty body)
    await put(markerPathname, " ", {
      token,
      access: "public",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
    });

    return created(c, body);
  });
}
