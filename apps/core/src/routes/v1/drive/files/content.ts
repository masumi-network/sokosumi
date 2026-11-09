import { createRoute, z } from "@hono/zod-openapi";
import { isDriveFolderMarker } from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { driveRead, driveReadUrl } from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contentDispositionFor,
  contentSecurityPolicyFor,
  isInlineRenderable,
} from "@/services/file-content.service";

/** Larger files are handed over as a short-lived signed address instead. */
const STREAM_MAX_BYTES = 25 * 1024 * 1024;
const SIGNED_DOWNLOAD_VALID_MS = 5 * 60 * 1000;

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/content",
    description: [
      "Stream one Drive file by pathname, for someone with access to its Drive.",
      "The way to a data room's files, whose storage URL does not open them;",
      "a file over 25 MB is a redirect to a signed address that works for five minutes.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      query: z.object({
        pathname: z.string().min(1).max(1_500),
        download: z.enum(["true", "false"]).optional(),
      }),
    },
    responses: {
      200: {
        description: "File bytes",
        content: { "*/*": { schema: { type: "string", format: "binary" } } },
      },
      302: { description: "Signed address of a large file" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const query = c.req.valid("query");
    const { scope, ownerId } = parseDriveFilePathname(
      query.pathname,
      userContext.userId,
    );
    await requireDriveFileAccess(authContext, scope, ownerId);
    if (isDriveFolderMarker(query.pathname)) throw notFound("File not found");

    const read = await driveRead(query.pathname);
    if (!read) throw notFound("File not found");
    if (read.size > STREAM_MAX_BYTES) {
      await read.stream.cancel();
      return c.redirect(
        await driveReadUrl(query.pathname, SIGNED_DOWNLOAD_VALID_MS),
        302,
      );
    }
    const name = query.pathname.split("/").at(-1) ?? "file";
    const inline =
      query.download !== "true" && isInlineRenderable(read.contentType);
    return c.body(read.stream, 200, {
      "content-type": read.contentType,
      "content-length": String(read.size),
      "cache-control": "private, no-store",
      "content-disposition": contentDispositionFor(name, inline),
      "x-content-type-options": "nosniff",
      "content-security-policy": contentSecurityPolicyFor(read.contentType),
    });
  });
}
