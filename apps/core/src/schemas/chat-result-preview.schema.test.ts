import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { chatResultPreviewSchema } from "./chat-result-preview.schema";

describe("chat result cards", () => {
  it("keeps unavailable results opaque and rejects external source links", () => {
    expect(
      chatResultPreviewSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        state: "unavailable",
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      state: "unavailable",
    });
    expect(
      chatResultPreviewSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        state: "available",
        kind: "task",
        capturedAt: "2026-10-06T10:00:00Z",
        title: "Launch",
        sourceHref: "https://evil.example",
        status: "READY",
        outputs: [],
      }).success,
    ).toBe(false);
  });

  it("defaults absent preview objects to null", () => {
    expect(
      chatResultPreviewSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        state: "available",
        kind: "task",
        capturedAt: "2026-10-06T10:00:00Z",
        title: "Launch",
        sourceHref: "/tasks/1",
        status: "READY",
      }),
    ).toMatchObject({
      task: null,
      social: null,
      actor: null,
      projectInfo: null,
      decision: null,
    });
  });

  it("emits nullable preview objects without a null subschema", () => {
    const app = new OpenAPIHono();
    app.openAPIRegistry.register("ChatResultPreview", chatResultPreviewSchema);
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    });
    const available = document.components?.schemas?.ChatResultAvailable;
    const properties = (
      available as { properties?: Record<string, object> } | undefined
    )?.properties;
    for (const name of ["task", "social", "actor", "projectInfo", "decision"]) {
      expect(properties?.[name]).toMatchObject({
        type: ["object", "null"],
        default: null,
      });
      for (const composition of ["anyOf", "oneOf", "allOf"]) {
        expect(properties?.[name]).not.toHaveProperty(composition);
      }
    }
  });
});
