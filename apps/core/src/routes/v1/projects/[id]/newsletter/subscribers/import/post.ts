import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  importNewsletterSubscribersRequestSchema,
  newsletterImportResultSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { importNewsletterSubscribers } from "@/services/newsletter.service";

import { newsletterScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/subscribers/import",
    tags: ["Projects"],
    description:
      "Import up to 5 MB / 50,000 CSV data rows with consent: true. Accepts email, e-mail or Email Address headers and an optional name column. Existing subscribers keep their status. Invalid rows are reported by record number (header is row 1), up to 100 entries.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: importNewsletterSubscribersRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(newsletterImportResultSchema, "Import summary"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Invalid CSV or missing consent"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    const result = await importNewsletterSubscribers(
      scope,
      c.req.valid("json").csv,
    );
    return ok(c, newsletterImportResultSchema.parse(result));
  });
}
