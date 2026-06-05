import { describe, expect, it } from "vitest";

import enterpriseContractsRouter from "./index";

interface OpenApiSchemaObject {
  $ref?: string;
  properties?: Record<string, unknown>;
}

function resolveOpenApiSchema(
  doc: ReturnType<typeof enterpriseContractsRouter.getOpenAPI31Document>,
  schema: OpenApiSchemaObject | undefined,
): OpenApiSchemaObject | undefined {
  if (!schema) {
    return undefined;
  }

  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const resolved = doc.components?.schemas?.[name];
    return typeof resolved === "object"
      ? (resolved as OpenApiSchemaObject)
      : undefined;
  }

  return schema;
}

function collectEnvelopeSchemasWithMeta(
  doc: ReturnType<typeof enterpriseContractsRouter.getOpenAPI31Document>,
): Map<string, string[]> {
  const envelopes = new Map<string, string[]>();

  for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
    if (
      schema &&
      typeof schema === "object" &&
      "properties" in schema &&
      schema.properties &&
      typeof schema.properties === "object" &&
      "meta" in schema.properties
    ) {
      envelopes.set(name, Object.keys(schema.properties));
    }
  }

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        method === "parameters" ||
        !operation ||
        typeof operation !== "object"
      ) {
        continue;
      }

      if (!("responses" in operation) || !operation.responses) {
        continue;
      }

      for (const [status, response] of Object.entries(operation.responses)) {
        if (!response || typeof response !== "object") {
          continue;
        }

        const content = response.content?.["application/json"];
        if (!content?.schema) {
          continue;
        }

        const resolved = resolveOpenApiSchema(
          doc,
          content.schema as OpenApiSchemaObject,
        );

        if (resolved?.properties && "meta" in resolved.properties) {
          const refName = (content.schema as OpenApiSchemaObject).$ref
            ?.split("/")
            .pop();
          envelopes.set(
            refName ?? `${path} ${method.toUpperCase()} ${status}`,
            Object.keys(resolved.properties),
          );
        }
      }
    }
  }

  return envelopes;
}

describe("enterprise contracts routes OpenAPI contract", () => {
  const doc = enterpriseContractsRouter.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Enterprise Contracts API",
      version: "1.0.0",
    },
  });

  it("exposes admin CRUD and lifecycle endpoints", () => {
    expect(doc.paths?.["/"]?.post).toBeDefined();
    expect(doc.paths?.["/"]?.get).toBeDefined();
    expect(doc.paths?.["/{id}"]?.get).toBeDefined();
    expect(doc.paths?.["/{id}"]?.patch).toBeDefined();
    expect(doc.paths?.["/{id}/activate"]?.post).toBeDefined();
    expect(doc.paths?.["/{id}/cancel"]?.post).toBeDefined();
    expect(doc.paths?.["/{id}/periods/preview"]?.get).toBeDefined();
  });

  it("documents 409 when previewing a non-draft contract", () => {
    const preview = doc.paths?.["/{id}/periods/preview"]?.get;

    expect(preview?.responses).toHaveProperty("409");
  });

  it("documents auth and conflict responses on activate", () => {
    const activate = doc.paths?.["/{id}/activate"]?.post;

    expect(activate?.responses).toHaveProperty("401");
    expect(activate?.responses).toHaveProperty("403");
    expect(
      activate?.responses?.["409"]?.content?.["application/json"]?.schema,
    ).toEqual({
      $ref: "#/components/schemas/EnterpriseContractActivationConflictResponse",
    });
  });

  it("documents kind on enterprise activation conflict schema", () => {
    const schema =
      doc.components?.schemas?.EnterpriseContractActivationConflictResponse;

    expect(schema).toBeDefined();
    expect(schema).toMatchObject({
      properties: {
        kind: {
          type: "string",
          enum: ["enterprise_activation_blocked"],
        },
      },
      required: expect.arrayContaining(["kind", "blocker", "meta"]),
    });
    expect(Object.keys(schema?.properties ?? {})).toEqual([
      "error",
      "message",
      "kind",
      "blocker",
      "meta",
    ]);
  });

  it("keeps meta as the last property on every response envelope schema", () => {
    const envelopes = collectEnvelopeSchemasWithMeta(doc);

    expect(envelopes.size).toBeGreaterThan(0);

    for (const [name, keys] of envelopes) {
      expect(keys.at(-1), `${name} property order`).toBe("meta");
    }
  });
});
