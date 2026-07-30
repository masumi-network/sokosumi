import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me files routes OpenAPI contract", () => {
  it("documents POST /files as a JSON direct-upload mint endpoint", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const requestBody = doc.paths?.["/{id}/files"]?.post?.requestBody;
    const description = doc.paths?.["/{id}/files"]?.post?.description;
    const requestBodyJson = JSON.stringify(requestBody);
    const requestSchema = doc.components?.schemas?.CreateUserFileUploadRequest;
    const requestSchemaJson = JSON.stringify(requestSchema);
    const responseSchema = doc.components?.schemas?.UserFileUploadSession;
    const responseSchemaJson = JSON.stringify(responseSchema);

    expect(description).toContain("uploadUrl");
    expect(description).toContain(
      "https://vercel.com/docs/vercel-blob/vercel-signed-urls",
    );
    expect(description).not.toContain("clientToken");
    expect(description).not.toContain("@vercel/blob/client");
    expect(requestBodyJson).toContain("application/json");
    expect(requestBodyJson).toContain("CreateUserFileUploadRequest");
    expect(requestSchemaJson).toContain('"filename"');
    expect(requestSchemaJson).toContain('"contentType"');
    expect(requestSchemaJson).toContain('"size"');
    expect(requestSchemaJson).toContain('"maxSizeBytes"');
    expect(requestSchemaJson).toContain('"allowedContentTypes"');
    expect(requestBodyJson).toContain("104857600");
    expect(responseSchemaJson).toContain('"uploadUrl"');
    expect(responseSchemaJson).not.toContain('"clientToken"');
  });

  it("does not document a root /files upload endpoint", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/files"]).toBeUndefined();
  });
});
