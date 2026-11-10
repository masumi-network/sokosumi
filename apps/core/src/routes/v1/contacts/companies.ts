import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  contactCompanyDetailSchema,
  contactCompanySchema,
} from "@/schemas/contact.schema";
import {
  COMPANY_SORTS,
  companyUpdateSchema,
  getCompany,
  listCompanies,
  updateCompany,
} from "@/services/contact-companies.service";
import { contactActor } from "./context";

const list = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/companies",
    tags: ["Contacts"],
    description:
      "The companies the workspace's contacts work at, with their facts and the relationship the team has there: people, teammates who know them, last contact, warmth and the strongest stage.",
    request: {
      query: z.object({
        search: z.string().trim().min(1).max(200).optional(),
        name: z.string().trim().min(1).max(200).optional().openapi({
          description:
            "Exactly the company this name belongs to, as the contact list's `company` filter reads it.",
        }),
        industry: z.string().trim().min(1).max(200).optional(),
        minPeople: z.coerce.number().int().min(1).max(100_000).optional(),
        sort: z.enum(COMPANY_SORTS).default("people"),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(contactCompanySchema),
        "Companies",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Invalid query"),
    },
  }),
);

const get = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/companies/{companyId}",
    tags: ["Contacts"],
    description:
      "One company: its facts and relationship, its people (latest contact first, at most 200), which teammates know them, open next steps and the latest touchpoints.",
    request: { params: z.object({ companyId: z.uuid() }) },
    responses: {
      200: jsonSuccessResponse(contactCompanyDetailSchema, "Company"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Company not found"),
    },
  }),
);

const patch = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/companies/{companyId}",
    tags: ["Contacts"],
    description:
      "Change a company's facts. `version` must be the one last read; otherwise 409. Omitted fields stay; null clears.",
    request: {
      params: z.object({ companyId: z.uuid() }),
      body: {
        content: { "application/json": { schema: companyUpdateSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactCompanySchema, "Company updated"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Company not found"),
      409: jsonErrorResponse("Version conflict"),
      422: jsonErrorResponse("Invalid company"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(list, async (c) => {
    const actor = await contactActor(c);
    const query = c.req.valid("query");
    const page = await listCompanies(actor, query);
    return ok(c, z.array(contactCompanySchema).parse(page.items), {
      cursor: null,
      limit: query.limit,
      total: page.total,
      nextCursor: null,
    });
  });
  app.openapi(get, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      contactCompanyDetailSchema.parse(
        await getCompany(actor, c.req.valid("param").companyId),
      ),
    );
  });
  app.openapi(patch, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      contactCompanySchema.parse(
        await updateCompany(
          actor,
          c.req.valid("param").companyId,
          c.req.valid("json"),
        ),
      ),
    );
  });
}
