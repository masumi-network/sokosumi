import { createRoute } from "@hono/zod-openapi";
import type { LanguageModel } from "ai";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  draftNewsletterIssueRequestSchema,
  newsletterIssueSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { generateNewsletterDraft } from "@/services/newsletter-draft.service";
import { createNewsletterIssue } from "@/services/newsletter-issues.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues/draft-with-ai",
    tags: ["Projects"],
    description:
      "Draft a newsletter from a brief and selected project sources. Always creates a DRAFT; never approves, schedules or sends.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: draftNewsletterIssueRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        newsletterIssueSchema,
        "Newsletter draft created",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Too Many Requests"),
    },
  }),
);

export default function mount(
  app: Pick<OpenAPIHonoWithAuth, "openapi">,
  model?: LanguageModel,
) {
  app.openapi(route, async (c) => {
    assertNewsletterEnabled();
    const user = await requireAuthorizedUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const scope = { projectId, workspaceId };
    const draft = await generateNewsletterDraft(
      { ...scope, userId: user.userId, organizationId: user.organizationId },
      c.req.valid("json"),
      model,
    );
    const issue = await createNewsletterIssue(scope, draft);
    return created(c, newsletterIssueSchema.parse(issue));
  });
}
