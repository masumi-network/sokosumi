import { createRoute, z } from "@hono/zod-openapi";
import { contactInteractionInputSchema } from "@sokosumi/utils";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactInteractionResultSchema,
  contactInteractionSchema,
  contactSchema,
} from "@/schemas/contact.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  inContactTransaction,
  listContactInteractions,
  logContactInteraction,
  removeContactInteraction,
} from "@/services/contacts.service";
import { contactActor } from "../context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not found"),
  422: jsonErrorResponse("Invalid input"),
};

const listRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/interactions",
    tags: ["Contacts"],
    description: "A contact's timeline, newest first.",
    request: {
      params: z.object({ id: z.uuid() }),
      query: cursorPaginationQuerySchema.extend({
        cursor: z.uuid().optional(),
      }),
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(contactInteractionSchema),
        "Interactions",
      ),
      ...errors,
    },
  }),
);

const logRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/interactions",
    tags: ["Contacts"],
    description:
      "Record an interaction the caller had with this contact. With a `sourceRef` (provider message or event id) the same one twice is recorded once. First contact, last contact and the count follow.",
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: contactInteractionInputSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        contactInteractionResultSchema,
        "Already recorded",
      ),
      201: jsonSuccessResponse(contactInteractionResultSchema, "Recorded"),
      409: jsonErrorResponse("Merged contact or a concurrent change"),
      ...errors,
    },
  }),
);

const removeRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/interactions/{interactionId}",
    tags: ["Contacts"],
    request: {
      params: z.object({ id: z.uuid(), interactionId: z.uuid() }),
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "Contact"),
      409: jsonErrorResponse("Merged contact or a concurrent change"),
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listRoute, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const page = await listContactInteractions(actor, id, query);
    return ok(c, z.array(contactInteractionSchema).parse(page.items), {
      cursor: query.cursor ?? null,
      limit: query.limit,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
  app.openapi(logRoute, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const result = contactInteractionResultSchema.parse(
      await inContactTransaction((tx) =>
        logContactInteraction(tx, actor, id, body),
      ),
    );
    return result.created ? created(c, result) : ok(c, result);
  });
  app.openapi(removeRoute, async (c) => {
    const actor = await contactActor(c);
    const { id, interactionId } = c.req.valid("param");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          removeContactInteraction(tx, actor, id, interactionId),
        ),
      ),
    );
  });
}
