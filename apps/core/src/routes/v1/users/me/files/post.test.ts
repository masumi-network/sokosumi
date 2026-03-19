import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me files routes OpenAPI contract", () => {
  it("documents 413 response on POST /files", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const responses = doc.paths?.["/files"]?.post?.responses;

    expect(Object.keys(responses ?? {})).toContain("413");
  });

  it("documents 422 response on POST /files", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const responses = doc.paths?.["/files"]?.post?.responses;

    expect(Object.keys(responses ?? {})).toContain("422");
  });

  it("documents a multipart binary file request body on POST /files", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const requestBody = doc.paths?.["/files"]?.post?.requestBody;

    expect(requestBody).toBeDefined();
    expect(requestBody).toHaveProperty("content.multipart/form-data");

    const requestBodyJson = JSON.stringify(requestBody);
    expect(requestBodyJson).toContain('"file"');
    expect(requestBodyJson).toContain('"binary"');
  });
});
