import { describe, expect, it } from "vitest";

import organizationsRouter from "../index";

describe("organizations/by-slug/{slug} OpenAPI contract", () => {
  it("documents organization lookup by slug", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const slugPath = Object.keys(doc.paths ?? {}).find((key) =>
      key.includes("by-slug"),
    );
    const responses = slugPath
      ? doc.paths?.[slugPath]?.get?.responses
      : undefined;

    expect(slugPath).toBeDefined();
    expect(responses).toBeDefined();
    expect(responses).toHaveProperty("200");
  });
});

describe("organizations/{id}/billing-plan OpenAPI contract", () => {
  it("documents billing plan endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const billingPlanPath = Object.keys(doc.paths ?? {}).find((key) =>
      key.includes("billing-plan"),
    );
    const responses = billingPlanPath
      ? doc.paths?.[billingPlanPath]?.get?.responses
      : undefined;

    expect(billingPlanPath).toBeDefined();
    expect(responses).toBeDefined();
    expect(JSON.stringify(responses?.["200"])).toContain("self_serve");
  });
});

describe("organizations/{id}/invoice-email OpenAPI contract", () => {
  it("documents invoice email patch endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const invoiceEmailPath = Object.keys(doc.paths ?? {}).find((key) =>
      key.includes("invoice-email"),
    );
    const responses = invoiceEmailPath
      ? doc.paths?.[invoiceEmailPath]?.patch?.responses
      : undefined;

    expect(invoiceEmailPath).toBeDefined();
    expect(responses).toBeDefined();
    expect(responses).toHaveProperty("200");
  });
});

describe("organizations/{id}/members/{memberId}/seat OpenAPI contract", () => {
  it("documents seat assign and unassign endpoints", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const pathKeys = Object.keys(doc.paths ?? {});
    const assignPath = pathKeys.find((key) => key.includes("seat/assign"));
    const unassignPath = pathKeys.find((key) => key.includes("seat/unassign"));

    expect(assignPath).toBeDefined();
    expect(unassignPath).toBeDefined();
    expect(doc.paths?.[assignPath!]?.post?.responses).toBeDefined();
    expect(doc.paths?.[unassignPath!]?.post?.responses).toBeDefined();
  });
});
