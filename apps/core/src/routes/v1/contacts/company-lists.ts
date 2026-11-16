import { createRoute, z } from "@hono/zod-openapi";
import {
  companyListInputSchema,
  companyListMembersSchema,
  companyListUpdateSchema,
} from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, empty, ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactCompanyListSchema } from "@/schemas/contact.schema";
import {
  createCompanyList,
  deleteCompanyList,
  listCompanyLists,
  updateCompanyList,
  updateCompanyListMembers,
} from "@/services/contact-company-lists.service";
import { inContactTransaction } from "@/services/contacts.service";
import { contactActor } from "./context";

const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("List or company not found"),
  409: jsonErrorResponse("Name taken"),
  422: jsonErrorResponse("Invalid list"),
};

const listParams = z.object({ listId: z.uuid() });

const list = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/company-lists",
    tags: ["Contacts"],
    description:
      "The workspace's company lists in name order, each with how many companies on it someone still works at.",
    responses: {
      200: jsonSuccessResponse(
        z.array(contactCompanyListSchema),
        "Company lists",
      ),
      401: errors[401],
      403: errors[403],
    },
  }),
);

const post = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/company-lists",
    tags: ["Contacts"],
    description:
      "Create a company list. Names are unique per workspace, ignoring case. Add companies with `POST /contacts/company-lists/{listId}/members`.",
    request: {
      body: {
        content: { "application/json": { schema: companyListInputSchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(contactCompanyListSchema, "List created"),
      ...errors,
    },
  }),
);

const patch = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/company-lists/{listId}",
    tags: ["Contacts"],
    description: "Rename a company list or change its color or description.",
    request: {
      params: listParams,
      body: {
        content: { "application/json": { schema: companyListUpdateSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactCompanyListSchema, "List"),
      ...errors,
    },
  }),
);

const remove = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/company-lists/{listId}",
    tags: ["Contacts"],
    description: "Delete a company list. The companies stay.",
    request: { params: listParams },
    responses: {
      204: { description: "List deleted" },
      ...errors,
    },
  }),
);

const members = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/company-lists/{listId}/members",
    tags: ["Contacts"],
    description:
      "Add and remove companies on a company list in one call, by the ids `GET /contacts/companies` returns. Adding one twice is a no-op.",
    request: {
      params: listParams,
      body: {
        content: { "application/json": { schema: companyListMembersSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(contactCompanyListSchema, "List"),
      ...errors,
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(list, async (c) => {
    const actor = await contactActor(c);
    return ok(
      c,
      z.array(contactCompanyListSchema).parse(await listCompanyLists(actor)),
    );
  });
  app.openapi(post, async (c) => {
    const actor = await contactActor(c);
    const body = c.req.valid("json");
    return created(
      c,
      contactCompanyListSchema.parse(
        await inContactTransaction((tx) => createCompanyList(tx, actor, body)),
      ),
    );
  });
  app.openapi(patch, async (c) => {
    const actor = await contactActor(c);
    const { listId } = c.req.valid("param");
    const body = c.req.valid("json");
    return ok(
      c,
      contactCompanyListSchema.parse(
        await inContactTransaction((tx) =>
          updateCompanyList(tx, actor, listId, body),
        ),
      ),
    );
  });
  app.openapi(remove, async (c) => {
    const actor = await contactActor(c);
    const { listId } = c.req.valid("param");
    await inContactTransaction((tx) => deleteCompanyList(tx, actor, listId));
    return empty(c);
  });
  app.openapi(members, async (c) => {
    const actor = await contactActor(c);
    const { listId } = c.req.valid("param");
    const body = c.req.valid("json");
    return ok(
      c,
      contactCompanyListSchema.parse(
        await inContactTransaction((tx) =>
          updateCompanyListMembers(tx, actor, listId, body),
        ),
      ),
    );
  });
}
