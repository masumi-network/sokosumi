import { createRoute } from "@hono/zod-openapi";
import { clampDriveFileName } from "@sokosumi/utils";
import { BlobNotFoundError } from "@vercel/blob";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
} from "@/helpers/drive-file-access";
import { parseCacheControlMaxAge } from "@/helpers/drive-file-move";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  driveCopy,
  driveExists,
  driveHasAny,
  driveHead,
} from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  copiedDriveFileSchema,
  copyDriveFileRequestSchema,
} from "@/schemas/drive-file.schema";
import { adoptDriveUploadResource } from "@/services/file-catalog.service";

/** Names tried ("x", "x 2" … "x 20") before the copy gives up with 409. */
const MAX_NAME_TRIES = 20;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/copy",
    description: [
      "Make a copy of a Drive file in the same folder.",
      "The source stays. The copy is a new document with its own catalog id;",
      "tags, links and shares are not copied. A taken name gets a number.",
      "Personal: owner only. Organization: any member.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: copyDriveFileRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(copiedDriveFileSchema, "Drive file copied"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - no free name for the copy"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

/** `report (copy).pdf`, try 3 → `report (copy) 3.pdf`. */
function numberedName(name: string, attempt: number): string {
  if (attempt === 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} ${attempt}${name.slice(dot)}`
    : `${name} ${attempt}`;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const { pathname, filename } = c.req.valid("json");

    const { scope, ownerId } = parseDriveFilePathname(
      pathname,
      userContext.userId,
    );
    const folderPrefix = pathname.slice(0, pathname.lastIndexOf("/") + 1);
    const folder = drivePathOf(folderPrefix).replace(/\/$/, "");

    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: [drivePathOf(pathname)],
      into: [folder],
    });

    const source = await driveHead(pathname);
    if (!source) throw notFound("Source file not found");

    const baseName = clampDriveFileName(filename);
    let name: string | null = null;
    for (let attempt = 1; attempt <= MAX_NAME_TRIES; attempt++) {
      const candidate = clampDriveFileName(numberedName(baseName, attempt));
      const candidatePathname = `${folderPrefix}${candidate}`;
      if (
        !(await driveExists(candidatePathname)) &&
        !(await driveHasAny(`${candidatePathname}/`))
      ) {
        name = candidate;
        break;
      }
    }
    if (!name) throw conflict("No free name for the copy");

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });

    let copied: Awaited<ReturnType<typeof driveCopy>>;
    try {
      copied = await driveCopy(pathname, `${folderPrefix}${name}`, {
        contentType: source.contentType,
        cacheControlMaxAge: parseCacheControlMaxAge(source.cacheControl),
      });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw notFound("Source file not found");
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("already exists")
      ) {
        throw conflict("Target pathname already exists");
      }
      throw error;
    }

    // A new document, not a second name for the old one: its own id, so
    // tags, project links and deletion never reach the source.
    const resourceId = await adoptDriveUploadResource({
      key: {
        workspaceId: workspace.workspaceId,
        scope,
        ownerId,
        pathname: copied.pathname,
      },
      displayName: name,
      mimeType: source.contentType ?? null,
      sizeBytes: source.size,
      uploadedAt: new Date(),
    });
    nudgeFileIndexing();

    return ok(
      c,
      copiedDriveFileSchema.parse({
        name,
        fileUrl: copied.url,
        pathname: copied.pathname,
        size: source.size,
        uploadedAt: new Date().toISOString(),
        dataRoom: copied.access === "private",
        resourceId,
      }),
    );
  });
}
