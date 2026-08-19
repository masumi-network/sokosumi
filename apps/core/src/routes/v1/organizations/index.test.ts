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

  it("exposes the organization-by-slug endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const getOperation = doc.paths?.["/slug/{slug}"]?.get;

    expect(getOperation).toBeDefined();
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("401");
    expect(getOperation?.responses).toHaveProperty("403");
    expect(getOperation?.responses).toHaveProperty("404");
  });

  it("exposes the organization members endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const getOperation = doc.paths?.["/{id}/members"]?.get;

    expect(getOperation).toBeDefined();
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("401");
    expect(getOperation?.responses).toHaveProperty("403");
    expect(getOperation?.responses).toHaveProperty("404");
  });

  it("does not expose the organization logo PUT endpoint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const putOperation = doc.paths?.["/{id}/logo"]?.put;

    expect(putOperation).toBeUndefined();
  });

  it("exposes POST /{id}/files for organization logo mint", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const postOperation = doc.paths?.["/{id}/files"]?.post;

    expect(postOperation).toBeDefined();
    expect(postOperation?.responses).toHaveProperty("201");
    expect(postOperation?.responses).toHaveProperty("401");
    expect(postOperation?.responses).toHaveProperty("403");
    expect(postOperation?.responses).toHaveProperty("503");
  });

  it("exposes GET /{id}/deletion for an organization owner", () => {
    const doc = organizationsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Organizations API",
        version: "1.0.0",
      },
    });

    const getOperation = doc.paths?.["/{id}/deletion"]?.get;
    expect(getOperation).toBeDefined();
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("401");
    expect(getOperation?.responses).toHaveProperty("403");
  });
});
