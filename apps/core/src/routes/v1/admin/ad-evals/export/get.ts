import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  auditAdEvalsExport,
  auditAdEvalsExportFailure,
} from "@/lib/ad-evals-audit";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { exportAdminAdEvals } from "@/services/ad-evals-export.service";

// Hono's JSON type matcher treats NDJSON as a JSON envelope; this response is a raw download.
const NDJSON_CONTENT_TYPE: string = "application/x-ndjson";

const route = createRoute({
  method: "get",
  path: "/export",
  operationId: "getAdminAdEvalsExport",
  tags: ["Admin"],
  responses: {
    200: {
      description:
        "Scrubbed human and implicit preference JSONL from training-consenting workspaces; image links expire in ten minutes",
      content: { [NDJSON_CONTENT_TYPE]: { schema: z.string() } },
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Image storage unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const admin = requireAdminAuthContext(c.var.authContext);
    try {
      const { jsonl, manifest } = await exportAdminAdEvals();
      auditAdEvalsExport(admin.userId, manifest);
      c.header("Content-Type", "application/x-ndjson; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="ad-evals-${manifest.exportId}.jsonl"`,
      );
      c.header("Cache-Control", "private, no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return new Response(jsonl, { status: 200, headers: c.res.headers });
    } catch (error) {
      auditAdEvalsExportFailure(admin.userId, c.var.requestId);
      throw error;
    }
  });
}
