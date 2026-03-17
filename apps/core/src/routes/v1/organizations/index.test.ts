import { describe, expect, it } from "vitest";

import organizationsRouter from "./index";

describe("organizations routes OpenAPI contract", () => {
  it("exposes the organization details endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const getOperation = doc.paths?.["/{id}"]?.get;

    expect(getOperation).toBeDefined();
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("401");
    expect(getOperation?.responses).toHaveProperty("403");
    expect(getOperation?.responses).toHaveProperty("404");
  });

  it("exposes the organization logo upload endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const putOperation = doc.paths?.["/{id}/logo"]?.put;

    expect(putOperation).toBeDefined();
    expect(putOperation?.responses).toHaveProperty("200");
    expect(putOperation?.responses).toHaveProperty("400");
    expect(putOperation?.responses).toHaveProperty("401");
    expect(putOperation?.responses).toHaveProperty("403");
    expect(putOperation?.responses).toHaveProperty("404");
    expect(putOperation?.responses).toHaveProperty("413");
    expect(putOperation?.responses).toHaveProperty("422");
    expect(putOperation?.responses).toHaveProperty("503");
    expect(putOperation?.requestBody).toBeDefined();
    expect(putOperation?.requestBody).toHaveProperty(
      "content.multipart/form-data",
    );

    const requestBody = JSON.stringify(putOperation?.requestBody);
    expect(requestBody).toContain("binary");
  });
});
