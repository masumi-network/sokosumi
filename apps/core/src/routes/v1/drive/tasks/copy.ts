import { createRoute } from "@hono/zod-openapi";
import { ssrfSafeFetch } from "@sokosumi/net";
import {
  buildOrganizationDriveFilePathname,
  buildUserDriveFilePathname,
  sanitizeDriveFileName,
} from "@sokosumi/utils";
import {
  BlobNotFoundError,
  head,
  list,
  type PutCommandOptions,
  put,
} from "@vercel/blob";
import { getEnv } from "@/config/env";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  copyTaskFileToDriveRequestSchema,
  copyTaskFileToDriveResponseSchema,
} from "@/schemas/drive-tasks.schema";

const route = createRoute({
  method: "post",
  path: "/copy",
  description: [
    "Copy a TaskFile to Drive root. Creates a new Drive file at Drive root using TaskFile.name.",
    "Source TaskFile and blob unchanged. Requires read access to the task and write access to the destination Drive.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: copyTaskFileToDriveRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      copyTaskFileToDriveResponseSchema,
      "TaskFile copied to Drive",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - file with that name already exists"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    // Find TaskFile
    const taskFile = await prisma.taskFile.findUnique({
      where: { id: body.taskFileId },
      include: {
        task: true,
      },
    });

    if (!taskFile) {
      throw notFound("TaskFile not found");
    }

    // Check read access to task
    await requireTaskReadForRouteVars(c.var, taskFile.task.id);

    // Determine destination pathname
    let destPathname: string;
    if (body.scope === "me") {
      const ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
      destPathname = buildUserDriveFilePathname(
        ownerId,
        sanitizeDriveFileName(taskFile.name),
      );
    } else {
      // scope === "org"
      if (!body.organizationId) {
        throw badRequest("organizationId is required when scope=org");
      }
      const ownerId = body.organizationId;
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId);
      destPathname = buildOrganizationDriveFilePathname(
        ownerId,
        sanitizeDriveFileName(taskFile.name),
      );
    }

    // Check for name collision in dest Drive
    try {
      await head(destPathname, { token });
      throw conflict("A file with that name already exists in Drive");
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        // File doesn't exist, proceed
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

    // Also check if a folder with the same prefix exists
    const folderPrefix = `${destPathname}/`;
    const existingFolder = await list({
      prefix: folderPrefix,
      token,
      limit: 1,
    });
    if (existingFolder.blobs.length > 0) {
      throw conflict("A folder with that name already exists in Drive");
    }

    // Copy blob: fetch source then put to dest
    let sourceBlob: ArrayBuffer;
    try {
      const fetchResult = await ssrfSafeFetch(taskFile.fileUrl);
      if (!fetchResult.ok) {
        throw serviceUnavailable(
          `Failed to fetch source blob: ${fetchResult.status}`,
        );
      }
      sourceBlob = await fetchResult.arrayBuffer();
    } catch (error) {
      throw serviceUnavailable(
        `Failed to fetch source blob: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const putOptions: PutCommandOptions = {
      token,
      access: "public",
      addRandomSuffix: false,
      contentType: taskFile.mimeType ?? "application/octet-stream",
    };

    try {
      const result = await put(destPathname, sourceBlob, putOptions);

      return created(
        c,
        copyTaskFileToDriveResponseSchema.parse({
          name: sanitizeDriveFileName(taskFile.name),
          fileUrl: result.url,
          pathname: result.pathname,
        }),
      );
    } catch (error) {
      throw serviceUnavailable(
        `Failed to copy blob to Drive: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
