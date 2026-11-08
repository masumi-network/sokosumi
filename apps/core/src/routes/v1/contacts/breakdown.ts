import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactListQuerySchema } from "@/schemas/contact.schema";
import {
  breakDownContactsBy,
  CONTACT_BREAKDOWNS,
} from "@/services/contact-breakdown.service";
import { contactActor, contactQueryOptions } from "./context";

const groupSchema = z.object({
  key: z.string().nullable(),
  label: z.string(),
  count: z.int(),
});

const breakdownSchema = z
  .object({
    total: z.int(),
    breakdowns: z.array(
      z.object({
        by: z.enum(CONTACT_BREAKDOWNS),
        groups: z.array(groupSchema),
        otherGroups: z.int(),
      }),
    ),
  })
  .openapi("ContactBreakdown");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/breakdown",
    tags: ["Contacts"],
    description:
      "How many contacts match the same filters as `GET /contacts`, and how they split by each of `by` (comma-separated): stage, kind, organization, location, role, list, knownBy, channel, source, lastContact.",
    request: {
      query: contactListQuerySchema
        .omit({ cursor: true, limit: true, sort: true, direction: true })
        .extend({
          by: z
            .string()
            .transform((value) => value.split(",").filter(Boolean))
            .pipe(z.array(z.enum(CONTACT_BREAKDOWNS)).max(6))
            .default([]),
          top: z.coerce.number().int().min(1).max(100).default(8),
        }),
    },
    responses: {
      200: jsonSuccessResponse(breakdownSchema, "Breakdown"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("List not found"),
      422: jsonErrorResponse("Invalid query"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const actor = await contactActor(c);
    const query = c.req.valid("query");
    const options = contactQueryOptions({
      ...query,
      sort: "updatedAt",
      limit: 1,
    });
    return ok(
      c,
      breakdownSchema.parse(
        await breakDownContactsBy(actor, {
          ...options,
          by: query.by,
          top: query.top,
        }),
      ),
    );
  });
}
