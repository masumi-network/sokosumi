import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adHocDesignMdSchema,
  adHocDesignMdWriteSchema,
} from "@/schemas/design-md.schema";

const route = createRoute({
  method: "post",
  path: "/design-md/adhoc",
  description:
    "Store a DESIGN.md for one-off, ad hoc use (e.g. a task that wants a different company's branding than the caller's own). The content is uploaded to blob storage and a URL is returned, but nothing is attached to the caller's user or organization profile — the caller is free to use it however they like, and it never affects what GET /workspaces/design-md resolves. Session users may call this; coworkers need authorized user-context binding (GRANTED workspace grant or baseline task relationship). It is not a privileged write.",
  tags: ["Workspaces"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: adHocDesignMdWriteSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adHocDesignMdSchema,
      "The stored ad hoc DESIGN.md",
      {
        data: {
          designMd: {
            url: "https://blob.example/design.md",
            extractionId: "12345",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - coworker context is not bound to the target user",
    ),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable - DESIGN.md storage failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const body = c.req.valid("json");

    const url = await uploadDesignMdContent({
      content: body.content,
      owner: { kind: "adhoc", id: userId },
      extractionId: body.extractionId,
    });

    if (!url) {
      throw serviceUnavailable("Failed to store the DESIGN.md");
    }

    return ok(
      c,
      adHocDesignMdSchema.parse({
        designMd: { url, extractionId: body.extractionId },
      }),
    );
  });
}
