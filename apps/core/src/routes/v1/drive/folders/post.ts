import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderMarkerPathname,
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderMarkerPathname,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobError } from "@vercel/blob";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { assertDriveFolderPathNotReserved } from "@/helpers/drive-folder-reserved-names";
import {
  badRequest,
  conflict,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { driveExists, driveHasAny, drivePut } from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { createDriveFolderRequestSchema } from "@/schemas/drive-file.schema";

const route = withCoworkerContextHeaderParameters(
  createRoute({
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const folderPath = normalizeDriveFolderPath(body.folderPath);
    if (!folderPath) {
      throw badRequest("Folder path cannot be empty");
    }

    assertDriveFolderPathNotReserved(folderPath);

    let markerPathname: string;
    let prefix: string;

    if (body.scope === "me") {
      const ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
      markerPathname = buildUserDriveFolderMarkerPathname(ownerId, folderPath);
      prefix = buildUserDriveFolderPrefix(ownerId, folderPath);
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
      prefix = buildOrganizationDriveFolderPrefix(ownerId, folderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    if (await driveHasAny(prefix)) {
      throw conflict("Folder already exists");
    }

    if (await driveExists(prefix.slice(0, -1))) {
      throw conflict("A file with that name already exists");
    }

    // Write the marker (one-byte blob; @vercel/blob requires non-empty body)
    try {
      await drivePut(markerPathname, " ", {
        addRandomSuffix: false,
        contentType: "application/octet-stream",
      });
    } catch (error) {
      if (error instanceof BlobError) {
        throw serviceUnavailable(`Blob storage error: ${error.message}`);
      }
      throw error;
    }

    return created(c, body);
  });
}
