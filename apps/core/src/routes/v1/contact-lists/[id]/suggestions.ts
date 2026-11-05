import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactPeopleSearchInputSchema,
  contactPeopleSearchResultSchema,
  contactSuggestionIdsSchema,
  contactSuggestionSchema,
} from "@/schemas/contact.schema";
import {
  addContactSuggestions,
  dismissContactSuggestions,
  findPeopleForList,
  listContactSuggestions,
} from "@/services/contact-suggestions.service";
import { contactActor } from "../../contacts/context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("List not found"),
  409: jsonErrorResponse("A concurrent change"),
  422: jsonErrorResponse(
    "A smart list, no description to search with, or not enough credits",
  ),
};

const idParams = z.object({ id: z.uuid() });

const listRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/suggestions",
    tags: ["Contact lists"],
    description:
      "People that Find people suggested for this manual list that nobody has added or dismissed yet, newest first.",
    request: { params: idParams },
    responses: {
      200: jsonSuccessResponse(z.array(contactSuggestionSchema), "Suggestions"),
      ...errors,
    },
  }),
);

const findRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/find",
    tags: ["Contact lists"],
    description:
      "Search the web for people who fit this manual list's description and suggest them on the list. Charges credits only when it finds someone; skips people already suggested or on the list.",
    request: {
      params: idParams,
      body: {
        content: {
          "application/json": { schema: contactPeopleSearchInputSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactPeopleSearchResultSchema, "Found"),
      ...errors,
      503: jsonErrorResponse("Web search is unavailable"),
    },
  }),
);

const decideRoute = (action: "add" | "dismiss") =>
  withCoworkerContextHeaderParameters(
    createRoute({
      method: "post",
      path: `/{id}/suggestions/${action}`,
      tags: ["Contact lists"],
      description:
        action === "add"
          ? "Add suggestions as Prospect contacts on this list, with why they fit; a contact that already has the profile is filled instead."
          : "Dismiss suggestions; they are never suggested to this list again.",
      request: {
        params: idParams,
        body: {
          content: {
            "application/json": { schema: contactSuggestionIdsSchema },
          },
        },
      },
      responses: {
        200: jsonSuccessResponse(
          z.object({ count: z.int() }),
          action === "add" ? "Added" : "Dismissed",
        ),
        ...errors,
      },
    }),
  );

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listRoute, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    return ok(
      c,
      z
        .array(contactSuggestionSchema)
        .parse(await listContactSuggestions(actor, id)),
    );
  });
  app.openapi(findRoute, async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    return ok(
      c,
      contactPeopleSearchResultSchema.parse(
        await findPeopleForList(actor, id, body),
      ),
    );
  });
  app.openapi(decideRoute("add"), async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const { ids } = c.req.valid("json");
    const { added } = await addContactSuggestions(actor, id, ids);
    return ok(c, { count: added });
  });
  app.openapi(decideRoute("dismiss"), async (c) => {
    const actor = await contactActor(c);
    const { id } = c.req.valid("param");
    const { ids } = c.req.valid("json");
    const { dismissed } = await dismissContactSuggestions(actor, id, ids);
    return ok(c, { count: dismissed });
  });
}
