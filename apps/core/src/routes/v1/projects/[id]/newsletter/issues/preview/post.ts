import { createRoute, z } from "@hono/zod-openapi";
import { renderNewsletterEmail } from "@sokosumi/email";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createNewsletterIssueRequestSchema,
  newsletterBrandSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { getNewsletter } from "@/services/newsletter.service";

import { newsletterIssueScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues/preview",
    tags: ["Projects"],
    description:
      "Render unsaved newsletter content using the sending renderer. Never sends email or saves an issue.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createNewsletterIssueRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ html: z.string() }),
        "Newsletter preview",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await newsletterIssueScope(c, id);
    const newsletter = await getNewsletter(scope);
    const { html } = await renderNewsletterEmail({
      newsletter: {
        name: newsletter.name,
        brand: newsletterBrandSchema.parse(newsletter.brand),
      },
      issue: c.req.valid("json"),
      unsubscribeUrl: "#",
    });
    return ok(c, { html });
  });
}
