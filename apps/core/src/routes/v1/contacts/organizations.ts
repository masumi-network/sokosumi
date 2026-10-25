import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactOrganizationSchema } from "@/schemas/contact.schema";
import { listContactOrganizations } from "@/services/contacts.service";
import { contactActor } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/organizations",
    tags: ["Contacts"],
    description:
      "The companies the workspace's contacts work at, with how many each, biggest first. Spellings of one company and colleagues on its email domain count as one. Pass a name as `company` to the contact list to see its people.",
    request: {
      query: z.object({
        search: z.string().trim().min(1).max(200).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(contactOrganizationSchema),
        "Organizations",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Invalid query"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const query = c.req.valid("query");
    return ok(c, await listContactOrganizations(actor, query));
  });
}
