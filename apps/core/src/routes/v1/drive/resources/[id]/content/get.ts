import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  contentDispositionFor,
  contentSecurityPolicyFor,
  openFileContentStream,
} from "@/services/file-content.service";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  download: z.enum(["true", "false"]).optional().openapi({
    description:
      "Force an attachment even for a type that would otherwise render in place.",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/content",
  description: [
    "Stream one file's current bytes, authorized per request.",
    "The stored object key never reaches a reader; the detail view renders",
    "from this route so no storage URL is handed out. A missing file and a",
    "denied one answer the same way.",
  ].join("\n"),
  tags: ["Drive"],
  request: { params: paramsSchema, query: querySchema },
  responses: {
    200: {
      description: "File bytes",
      content: { "*/*": { schema: { type: "string", format: "binary" } } },
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    // The entry is real but the object store is not configured here. A caller
    // should retry rather than treat the file as deleted.
    503: jsonErrorResponse("Service Unavailable - file storage unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    const result = await openFileContentStream({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
      download: query.download === "true",
    });

    return c.body(result.stream, 200, {
      "content-type": result.contentType,
      ...(result.size === null
        ? {}
        : { "content-length": String(result.size) }),
      // The bytes are immutable for a revision, but permission to read them
      // is not. `no-cache` keeps the browser's copy and forces it back
      // through this route — which re-checks access — before reuse, and the
      // etag makes that revalidation a cheap 304 — once someone adds
      // conditional-request handling, which nothing here does yet. The tag
      // is derived from the resource id and content revision, so it does
      // move when a re-upload changes the bytes.
      "cache-control": "private, no-cache",
      etag: `"${result.entityTag}"`,
      "content-disposition": contentDispositionFor(
        result.displayName,
        result.inline,
      ),
      // Two belts for user-supplied bytes served from our own origin: never
      // let the browser re-guess the type, and give the document an opaque
      // origin so it cannot reach this one even if something slips past the
      // inline allowlist.
      "x-content-type-options": "nosniff",
      "content-security-policy": contentSecurityPolicyFor(result.contentType),
    });
  });
}
