import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactSuggestionSchema } from "@/schemas/contact.schema";
import { fundraisingSuggestionIdsSchema } from "@/schemas/fundraising.schema";
import {
  addInvestorSuggestions,
  dismissInvestorSuggestions,
  listInvestorSuggestions,
} from "@/services/fundraising-research.service";
import { fundraisingActor } from "./context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const listRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/suggestions",
    tags: ["Fundraising"],
    description:
      "Investors found for the raise and not yet added or dismissed, newest first.",
    responses: {
      200: jsonSuccessResponse(z.array(contactSuggestionSchema), "Suggestions"),
      ...errors,
    },
  }),
);

const addRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/suggestions/add",
    tags: ["Fundraising"],
    description:
      "Makes the suggestions contacts on the Investors list, each marked as found with Exa.",
    request: {
      body: {
        content: {
          "application/json": { schema: fundraisingSuggestionIdsSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(z.object({ added: z.int() }), "Added"),
      ...errors,
    },
  }),
);

const dismissRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/suggestions/dismiss",
    tags: ["Fundraising"],
    description: "Dismissed investors are never suggested again.",
    request: {
      body: {
        content: {
          "application/json": { schema: fundraisingSuggestionIdsSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(z.object({ dismissed: z.int() }), "Dismissed"),
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listRoute, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      z
        .array(contactSuggestionSchema)
        .parse(await listInvestorSuggestions(actor)),
    );
  });
  app.openapi(addRoute, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(c, await addInvestorSuggestions(actor, c.req.valid("json").ids));
  });
  app.openapi(dismissRoute, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      await dismissInvestorSuggestions(actor, c.req.valid("json").ids),
    );
  });
}
