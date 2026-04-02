import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me uploads routes OpenAPI contract", () => {
  it("documents POST /uploads as a JSON endpoint", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const requestBody = doc.paths?.["/uploads"]?.post?.requestBody;
    const description = doc.paths?.["/uploads"]?.post?.description;
    const requestBodyJson = JSON.stringify(requestBody);
    const requestSchema = doc.components?.schemas?.CreateUserFileUploadRequest;
    const requestSchemaJson = JSON.stringify(requestSchema);

    expect(description).toContain("/mpu");
    expect(description).toContain("put(pathname, file");
    expect(description).toContain(
      "https://vercel.com/docs/storage/vercel-blob/using-blob-sdk",
    );
    expect(requestBodyJson).toContain("application/json");
    expect(requestBodyJson).toContain("CreateUserFileUploadRequest");
    expect(requestSchemaJson).toContain('"filename"');
    expect(requestSchemaJson).toContain('"contentType"');
    expect(requestSchemaJson).toContain('"size"');
    expect(requestSchemaJson).toContain('"maxSizeBytes"');
    expect(requestSchemaJson).toContain('"allowedContentTypes"');
    expect(requestBodyJson).toContain("1073741824");
  });

  it("does not document legacy /files upload endpoints", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/files"]).toBeUndefined();
  });
});
