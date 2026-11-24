import apiV1 from "./index.js";

let document: ReturnType<typeof apiV1.getOpenAPI31Document> | undefined;

/**
 * Core's `/v1` OpenAPI document, for `/llms.txt` and the MCP tool schemas.
 * Building it takes over a second, so it is built on first use, not at
 * startup, and kept for the life of the process.
 */
export function getV1OpenApiDocument() {
  document ??= apiV1.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Sokosumi API",
      version: "1.0.0",
      description: "Sokosumi API documentation",
    },
  });
  return document;
}
