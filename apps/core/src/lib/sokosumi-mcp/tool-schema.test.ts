import { describe, expect, it } from "vitest";

import { deriveToolInput, getTools, type OpenApiDocument } from "./tool-schema";
import { MCP_TOOLS } from "./tools";

const doc: OpenApiDocument = {
  paths: {
    "/things/{id}": {
      get: {
        parameters: [
          { $ref: "#/components/parameters/OrganizationSlug" },
          { $ref: "#/components/parameters/ContextUserId" },
          {
            name: "id",
            in: "path",
            required: true,
            description: "Thing id",
            schema: { type: "string" },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "array",
              items: { $ref: "#/components/schemas/Status" },
            },
          },
          {
            name: "limit",
            in: "query",
            required: true,
            schema: { type: "integer" },
          },
        ],
      },
      patch: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ThingPatch" },
            },
          },
        },
      },
      put: {
        parameters: [{ name: "body", in: "query", schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
  },
  components: {
    parameters: {
      OrganizationSlug: {
        name: "X-Organization-Slug",
        in: "header",
        schema: { type: "string" },
      },
      ContextUserId: {
        name: "X-Context-User-Id",
        in: "header",
        schema: { type: "string" },
      },
    },
    schemas: {
      Status: { type: "string", enum: ["READY", "DONE"] },
      ThingPatch: {
        type: "object",
        properties: { owner: { $ref: "#/components/schemas/Owner" } },
      },
      Owner: { type: "object", properties: { name: { type: "string" } } },
    },
  },
};

describe("deriveToolInput", () => {
  it("maps path and query parameters by name, and the slug header to workspace", () => {
    const input = deriveToolInput(doc, "GET /things/{id}");

    expect(input).toMatchObject({
      method: "GET",
      path: "/things/{id}",
      pathParams: ["id"],
      queryParams: ["status", "limit"],
      hasBody: false,
    });
    expect(input.inputSchema).toEqual({
      type: "object",
      properties: {
        workspace: expect.objectContaining({ type: "string" }),
        id: { type: "string", description: "Thing id" },
        status: { type: "array", items: { $ref: "#/$defs/Status" } },
        limit: { type: "integer" },
      },
      required: ["id", "limit"],
      additionalProperties: false,
      $defs: { Status: { type: "string", enum: ["READY", "DONE"] } },
    });
  });

  it("maps the JSON body to body, with the schemas it reaches in $defs", () => {
    const { inputSchema, hasBody } = deriveToolInput(doc, "PATCH /things/{id}");

    expect(hasBody).toBe(true);
    expect(inputSchema.required).toEqual(["id", "body"]);
    expect(inputSchema.properties).toMatchObject({
      body: { $ref: "#/$defs/ThingPatch" },
    });
    expect(inputSchema.$defs).toEqual({
      ThingPatch: {
        type: "object",
        properties: { owner: { $ref: "#/$defs/Owner" } },
      },
      Owner: { type: "object", properties: { name: { type: "string" } } },
    });
  });

  it("refuses an argument name used twice", () => {
    expect(() => deriveToolInput(doc, "PUT /things/{id}")).toThrow(
      'PUT /things/{id}: two arguments are named "body".',
    );
  });

  it("refuses an operation Core does not serve", () => {
    expect(() => deriveToolInput(doc, "DELETE /things/{id}")).toThrow(
      "Core's OpenAPI document has no DELETE /things/{id}.",
    );
  });
});

describe("getTools", () => {
  it("derives every tool from Core's OpenAPI document, once", () => {
    const tools = getTools();

    expect([...tools.keys()]).toEqual(MCP_TOOLS.map((tool) => tool.name));
    expect(getTools()).toBe(tools);
    expect(tools.get("tasks_get")?.input).toMatchObject({
      method: "GET",
      path: "/tasks/{id}",
      pathParams: ["id"],
      queryParams: ["archived"],
      inputSchema: { required: ["id"] },
    });
  });

  it("gives every schema reference a definition", () => {
    for (const {
      input: { inputSchema },
    } of getTools().values()) {
      const refs = JSON.stringify(inputSchema).match(/"#\/[^"]+"/g) ?? [];
      for (const ref of refs) {
        expect(ref).toMatch(/^"#\/\$defs\/[^/"]+"$/);
        const name = ref.slice('"#/$defs/'.length, -1);
        expect(inputSchema.$defs).toHaveProperty(name);
      }
    }
  });
});
