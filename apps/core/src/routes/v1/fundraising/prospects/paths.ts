import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { fundraisingPathsSchema } from "@/schemas/fundraising.schema";
import {
  researchPortfolio,
  warmPaths,
} from "@/services/fundraising-paths.service";
import { fundraisingActor } from "../context";

const params = z.object({ contactId: z.uuid() });
const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not on the Investors list"),
};

const pathsRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/prospects/{contactId}/paths",
    tags: ["Fundraising"],
    description:
      "The investor's portfolio as researched, and every warm path the workspace has to them, strongest first: teammates who know them, contacts at the fund, contacts at the companies they backed.",
    request: { params },
    responses: {
      200: jsonSuccessResponse(fundraisingPathsSchema, "Paths"),
      ...errors,
    },
  }),
);

const researchRoute = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/prospects/{contactId}/research",
    tags: ["Fundraising"],
    description:
      "Looks the investor's fund up with Exa's agent and replaces the stored portfolio (company, round, date, source). One flat Exa charge, recorded against the month's research cap. Answers with the paths.",
    request: { params },
    responses: {
      200: jsonSuccessResponse(fundraisingPathsSchema, "Paths"),
      ...errors,
      422: jsonErrorResponse(
        "No fund on the contact, Exa missing, or the cap is reached",
      ),
      503: jsonErrorResponse("Exa did not answer"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(pathsRoute, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingPathsSchema.parse(
        await warmPaths(actor, c.req.valid("param").contactId),
      ),
    );
  });
  app.openapi(researchRoute, async (c) => {
    const actor = await fundraisingActor(c);
    return ok(
      c,
      fundraisingPathsSchema.parse(
        await researchPortfolio(actor, c.req.valid("param").contactId),
      ),
    );
  });
}
