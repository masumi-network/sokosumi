import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactWebEnrichmentSchema } from "@/schemas/contact.schema";
import { enrichContactFromWeb } from "@/services/contact-suggestions.service";
import { contactActor } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/enrich",
    tags: ["Contacts"],
    description:
      "Look this person up on the web and fill their empty role, organization, location and summary, and their LinkedIn when they have none. Never overwrites; each filled field keeps its source page in the contact's history. Costs 1 credit, and nothing when it filled nothing.",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: jsonSuccessResponse(contactWebEnrichmentSchema, "Enriched"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      422: jsonErrorResponse("Not a person, or not enough credits"),
      503: jsonErrorResponse("Web search is unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    return ok(
      c,
      contactWebEnrichmentSchema.parse(await enrichContactFromWeb(actor, id)),
    );
  });
}
