import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list, rename } from "@vercel/blob";
import pLimit from "p-limit";

import { getEnv } from "@/config/env";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { assertDriveFolderPathNotReserved } from "@/helpers/drive-folder-reserved-names";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { renameDriveFolderRequestSchema } from "@/schemas/drive-file.schema";
import { reconcileDriveUploadMoves } from "@/services/file-catalog.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/rename",
    description: [
      "Rename a Drive folder (rename all blobs under the old prefix to new prefix).",
      "Personal: owner only. Organization: any member.",
      "409 if target folder path already exists.",
      "Renames all blobs recursively (files and nested folder markers).",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: renameDriveFolderRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        renameDriveFolderRequestSchema,
        "Drive folder renamed",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - target folder already exists"),
      422: jsonErrorResponse(
        "Unprocessable Entity - folder exceeds 500 descendant limit",
      ),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

// Maximum descendants allowed for folder rename/move operations
const MAX_FOLDER_DESCENDANTS = 500;

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

    const oldFolderPath = normalizeDriveFolderPath(body.oldFolderPath);
    const newFolderPath = normalizeDriveFolderPath(body.newFolderPath);

    if (!oldFolderPath || !newFolderPath) {
      throw badRequest("Folder paths cannot be empty");
    }

    assertDriveFolderPathNotReserved(newFolderPath);

    let oldPrefix: string;
    let newPrefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (body.scope === "me") {
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      oldPrefix = buildUserDriveFolderPrefix(ownerId, oldFolderPath);
      newPrefix = buildUserDriveFolderPrefix(ownerId, newFolderPath);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      ownerId = body.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      oldPrefix = buildOrganizationDriveFolderPrefix(ownerId, oldFolderPath);
      newPrefix = buildOrganizationDriveFolderPrefix(ownerId, newFolderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    const sourceCheck = await list({
      prefix: oldPrefix,
      token,
      limit: 1,
    });

    if (sourceCheck.blobs.length === 0) {
      throw notFound("Source folder not found");
    }

    const targetCheck = await list({
      prefix: newPrefix,
      token,
      limit: 1,
    });

    if (targetCheck.blobs.length > 0) {
      throw conflict("Target folder already exists");
    }

    try {
      await head(newPrefix.slice(0, -1), { token });
      throw conflict("A file with that name already exists");
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) {
        throw error;
      }
    }

    if (
      newPrefix === oldPrefix ||
      newPrefix.startsWith(`${oldPrefix}`) // oldPrefix already ends with /
    ) {
      throw badRequest("Cannot rename a folder into its own descendant");
    }

    // Collect all pathnames under old prefix (capped at MAX+1 for detection)
    const allPathnames: string[] = [];
    let cursor: string | undefined;

    do {
      const result = await list({
        prefix: oldPrefix,
        token,
        cursor,
        limit: 1000,
      });

      for (const blob of result.blobs) {
        if (allPathnames.length > MAX_FOLDER_DESCENDANTS) {
          throw unprocessableEntity(
            `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot rename.`,
          );
        }
        allPathnames.push(blob.pathname);
      }

      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    // If exactly at MAX+1, we exceeded the limit
    if (allPathnames.length > MAX_FOLDER_DESCENDANTS) {
      throw unprocessableEntity(
        `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot rename.`,
      );
    }

    // Resolve the workspace *before* anything is mutated. Doing it after
    // the renames meant a failure here left the objects moved and the
    // catalog untouched, with no way back.
    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: body.scope,
      organizationId: body.scope === "org" ? body.organizationId : undefined,
    });

    // Bounded-concurrency head + rename (10 concurrent operations)
    const limit = pLimit(10);

    // Pairs that really moved, collected as they succeed so a partial
    // failure reconciles exactly what happened and nothing more.
    const moved: { fromPathname: string; toPathname: string }[] = [];

    const renameTasks = allPathnames.map((sourcePathname) =>
      limit(async () => {
        const relativePath = sourcePathname.slice(oldPrefix.length);
        const newPathname = `${newPrefix}${relativePath}`;

        // Skip if already at target (retry-safe). It still counts as
        // moved: on a retry of a half-completed rename these are exactly
        // the files that moved on the first attempt, and skipping them
        // without recording the pair is what left them never reconciled.
        try {
          const targetCheck = await head(newPathname, { token });
          if (targetCheck) {
            moved.push({
              fromPathname: sourcePathname,
              toPathname: newPathname,
            });
            return;
          }
        } catch (error) {
          if (!(error instanceof BlobNotFoundError)) {
            throw error;
          }
        }

        let sourceMetadata;
        try {
          sourceMetadata = await head(sourcePathname, { token });
        } catch (error) {
          if (error instanceof BlobNotFoundError) {
            // Source already moved or deleted, skip (retry-safe)
            return;
          }
          throw error;
        }

        const maxAge = parseCacheControlMaxAge(sourceMetadata.cacheControl);
        try {
          await rename(sourcePathname, newPathname, {
            token,
            access: "public",
            addRandomSuffix: false,
            contentType: sourceMetadata.contentType,
            cacheControlMaxAge: maxAge,
          });
        } catch (error) {
          if (error instanceof BlobNotFoundError) {
            // Source was already moved/deleted (concurrent/retry), skip
            return;
          }
          throw error;
        }

        moved.push({ fromPathname: sourcePathname, toPathname: newPathname });
      }),
    );

    // `allSettled`, not `all`. `Promise.all` rejects on the first failure,
    // so the reconcile below was never reached — while every rename that
    // had already committed stayed committed, and the tasks still in
    // flight kept renaming, because `pLimit` does not cancel. A folder that
    // half-moved left its documents indexed at pathnames that no longer
    // hold them, and each vacated pathname free for a later upload to
    // inherit that document's manual tags.
    const outcomes = await Promise.allSettled(renameTasks);

    // Follow the objects in the catalog. Without this every document under
    // the renamed folder stayed indexed at its old pathname. This runs for
    // whatever actually moved, including after a partial failure.
    if (moved.length > 0) {
      await reconcileDriveUploadMoves({
        workspaceId: workspace.workspaceId,
        scope,
        moves: moved,
      });
    }

    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed) throw failed.reason;

    return ok(c, body);
  });
}

/**
 * Parse max-age from Cache-Control header.
 * Example: "public, max-age=31536000" → 31536000
 */
function parseCacheControlMaxAge(cacheControl: string): number | undefined {
  const match = /max-age=(\d+)/.exec(cacheControl);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
