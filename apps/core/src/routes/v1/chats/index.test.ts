import { describe, expect, it } from "vitest";

import chatsRouter from "./index";

const openApiInfo = {
  openapi: "3.1.0",
  info: { title: "Chats API", version: "1.0.0" },
} as const;

describe("chats routes OpenAPI contract", () => {
  it("does not expose legacy conversation product endpoints", () => {
    const doc = chatsRouter.getOpenAPI31Document(openApiInfo);
    const paths = Object.keys(doc.paths ?? {});

    expect(paths.some((path) => path.includes("conversation"))).toBe(false);
  });

  it("still exposes room routes", () => {
    const doc = chatsRouter.getOpenAPI31Document(openApiInfo);

    expect(doc.paths?.["/rooms"]).toBeDefined();
    expect(doc.paths?.["/rooms/{id}/stream"]).toBeDefined();
  });

  it("exposes invitee invitation routes", () => {
    const doc = chatsRouter.getOpenAPI31Document(openApiInfo);

    expect(doc.paths?.["/invitations"]).toBeDefined();
    expect(doc.paths?.["/invitations/{id}"]).toBeDefined();
    expect(doc.paths?.["/invitations/{id}/accept"]).toBeDefined();
    expect(doc.paths?.["/invitations/{id}/decline"]).toBeDefined();
  });
});
