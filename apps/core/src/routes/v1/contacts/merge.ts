import { createRoute, z } from "@hono/zod-openapi";
import { mergeContactsSchema } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { empty, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactDuplicateGroupSchema,
  contactSchema,
} from "@/schemas/contact.schema";
import {
  findDuplicateContacts,
  inContactTransaction,
  markNotDuplicates,
  mergeContacts,
} from "@/services/contacts.service";
import { contactActor } from "./context";

const mergeRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/merge",
    tags: ["Contacts"],
    description:
      "Fold contacts into one: channels, interactions, list memberships and history move to the winner, its empty fields are filled from the others in order, and each merged contact stays as a tombstone pointing at the winner.",
    request: {
      body: {
        content: { "application/json": { schema: mergeContactsSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactSchema, "The merged contact"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      409: jsonErrorResponse("Already merged, or a concurrent change"),
      422: jsonErrorResponse("Invalid merge"),
    },
  }),
);

const duplicatesRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/duplicates",
    tags: ["Contacts"],
    description:
      "Groups of live contacts that share a name (case and spacing ignored): likely the same person, worth a merge. At most `limit` groups (default 50, up to 200).",
    request: {
      query: z.object({
        contactId: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(contactDuplicateGroupSchema),
        "Duplicate groups",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Invalid query"),
    },
  }),
);

const notDuplicatesRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/duplicates/dismiss",
    tags: ["Contacts"],
    description:
      "Mark contacts as different people: `GET /contacts/duplicates` no longer groups any two of them. They can still be merged on purpose.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              contactIds: z.array(z.uuid()).min(2).max(50),
            }),
          },
        },
      },
    },
    responses: {
      204: { description: "Marked as different people" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Contact not found"),
      422: jsonErrorResponse("Invalid request"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(notDuplicatesRoute, async (c) => {
    const actor = await contactActor(c);
    const { contactIds } = c.req.valid("json");
    await inContactTransaction((tx) =>
      markNotDuplicates(tx, actor, contactIds),
    );
    return empty(c);
  });
  app.openapi(mergeRoute, async (c) => {
    const actor = await contactActor(c);
    const { winnerId, loserIds } = c.req.valid("json");
    return ok(
      c,
      contactSchema.parse(
        await inContactTransaction((tx) =>
          mergeContacts(tx, actor, winnerId, loserIds),
        ),
      ),
    );
  });
  app.openapi(duplicatesRoute, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      z
        .array(contactDuplicateGroupSchema)
        .parse(await findDuplicateContacts(actor, c.req.valid("query"))),
    );
  });
}
