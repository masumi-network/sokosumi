import { describe, expect, it } from "vitest";

import enterpriseContractsRouter from "./index";

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
});
