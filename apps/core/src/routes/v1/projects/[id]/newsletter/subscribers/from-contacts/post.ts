import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  addNewsletterSubscribersFromContactsRequestSchema,
  newsletterAddFromContactsResultSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { addNewsletterSubscribersFromContacts } from "@/services/newsletter.service";

import { newsletterScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/subscribers/from-contacts",
    tags: ["Projects"],
    description:
      "Add workspace contacts directly or from manual and smart lists, once per person. Archived contacts are skipped and merged contacts resolve to their survivor. Uses the primary email, otherwise the oldest email. CONFIRMED records existing consent; ASK sends double opt-in emails. Existing subscribers keep their status. Added includes pendingConfirmation.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: addNewsletterSubscribersFromContactsRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        newsletterAddFromContactsResultSchema,
        "Subscriber summary",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse(
        "Newsletter, contact or list not found in workspace",
      ),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Invalid contacts or missing consent"),
      429: jsonErrorResponse("Confirmation request limit exceeded"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    const result = await addNewsletterSubscribersFromContacts(
      scope,
      c.req.valid("json"),
      c.var.authContext,
      c.req.raw,
    );
    return ok(c, newsletterAddFromContactsResultSchema.parse(result));
  });
}
