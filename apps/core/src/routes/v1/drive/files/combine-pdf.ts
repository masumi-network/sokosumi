import { createRoute, z } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
  clampDriveFileName,
  isDriveFolderMarkerName,
} from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  badRequest,
  conflict,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  driveExists,
  driveHasAny,
  driveHead,
  drivePut,
  driveRead,
} from "@/lib/drive-blob";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  combinePdfs,
  UnreadablePdfError,
} from "@/services/drive-pdf-combine.service";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";

/** All sources together; pdf-lib holds them in memory at once. */
export const COMBINE_PDF_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PDF = "application/pdf";

const bodySchema = z.object({
  pathnames: z.array(z.string().min(1).max(1_000)).min(2).max(20),
  filename: z.string().trim().min(1).max(200),
});

const responseSchema = z.object({
  resourceId: z.string(),
  name: z.string(),
  pathname: z.string(),
  pageCount: z.number().int(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/combine-pdf",
    description: [
      "Combine 2–20 PDFs from one Drive into a new PDF, pages in the order of `pathnames`.",
      "Saved beside the first file as `filename` (.pdf added when missing). The sources stay as they are.",
      `All or nothing: a source that is missing, not a PDF, encrypted or broken fails the whole request, and nothing is saved. Sources total at most ${COMBINE_PDF_MAX_TOTAL_BYTES} bytes.`,
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(responseSchema, "Combined PDF saved"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - a file with that name already exists"),
      413: jsonErrorResponse("Payload Too Large"),
      422: jsonErrorResponse("Unprocessable Entity - a source is not a PDF"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

function fileName(pathname: string): string {
  return pathname.split("/").at(-1) ?? pathname;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const owners = body.pathnames.map((pathname) =>
      parseDriveFilePathname(pathname, userContext.userId),
    );
    const [{ scope, ownerId }] = owners;
    if (owners.some((o) => o.scope !== scope || o.ownerId !== ownerId))
      throw unprocessableEntity("Combine files from one Drive");

    const name = clampDriveFileName(
      /\.pdf$/i.test(body.filename) ? body.filename : `${body.filename}.pdf`,
    );
    if (isDriveFolderMarkerName(name))
      throw badRequest("That name is reserved; choose another");

    const folder = drivePathOf(body.pathnames[0])
      .split("/")
      .slice(0, -1)
      .join("/");
    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: body.pathnames.map(drivePathOf),
    });
    const pathname =
      scope === "user"
        ? buildUserDriveFilePathnameWithFolder(ownerId, folder, name)
        : buildOrganizationDriveFilePathnameWithFolder(ownerId, folder, name);
    if (scope === "user")
      await requireUserDriveFileUploadAccess(authContext, ownerId);
    else
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId, {
        into: [folder],
      });

    if ((await driveExists(pathname)) || (await driveHasAny(`${pathname}/`)))
      throw conflict(`A file named "${name}" already exists in this folder`);

    const heads = await Promise.all(body.pathnames.map((p) => driveHead(p)));
    let total = 0;
    for (const [index, head] of heads.entries()) {
      const source = fileName(body.pathnames[index]);
      if (!head) throw notFound(`"${source}" was not found`);
      if (head.contentType !== PDF)
        throw unprocessableEntity(`"${source}" is not a PDF`, {
          kind: "unreadable_pdf",
        });
      total += head.size;
    }
    if (total > COMBINE_PDF_MAX_TOTAL_BYTES)
      throw payloadTooLarge(
        `These files add up to more than ${COMBINE_PDF_MAX_TOTAL_BYTES / 1024 / 1024} MB; combine fewer at once`,
      );

    const sources = await Promise.all(
      body.pathnames.map(async (p) => {
        const read = await driveRead(p);
        if (!read) throw notFound(`"${fileName(p)}" was not found`);
        const bytes = new Uint8Array(
          await new Response(read.stream).arrayBuffer(),
        );
        return { name: fileName(p), bytes };
      }),
    );

    let combined: Awaited<ReturnType<typeof combinePdfs>>;
    try {
      combined = await combinePdfs(sources);
    } catch (error) {
      if (error instanceof UnreadablePdfError)
        throw unprocessableEntity(
          `"${error.fileName}" could not be read as a PDF (it may be broken or password-protected). Nothing was saved.`,
          { kind: "unreadable_pdf" },
        );
      throw error;
    }

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });
    const key = {
      workspaceId: workspace.workspaceId,
      scope,
      ownerId,
      pathname,
    };
    const sizeBytes = combined.bytes.byteLength;
    await reserveDriveUploadResource({
      key,
      displayName: name,
      mimeType: PDF,
      sizeBytes,
    });
    await drivePut(pathname, Buffer.from(combined.bytes), {
      contentType: PDF,
      addRandomSuffix: false,
    });
    const activated = await activateDriveUploadResource({
      key,
      sizeBytes,
      mimeType: PDF,
    });
    if (!activated) throw notFound("The combined file could not be saved");
    nudgeFileIndexing();

    return created(
      c,
      responseSchema.parse({
        resourceId: activated.resourceId,
        name,
        pathname,
        pageCount: combined.pageCount,
      }),
    );
  });
}
