import { describe, expect, it } from "vitest";

import developerTasksRouter from "../../developer/tasks/index";
import adminTasksRouter from "./index";

function componentSchemas(router: typeof adminTasksRouter) {
  return (
    router.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Tasks API", version: "1.0.0" },
    }).components?.schemas ?? {}
  );
}

// `owner` keeps its meaning and is null for a Task without an Owner
// (ADR 0057).
describe("admin and developer task OpenAPI contract", () => {
  it.each([
    ["AdminTaskListItem", adminTasksRouter],
    ["AdminTaskDetail", adminTasksRouter],
    ["DeveloperTaskListItem", developerTasksRouter],
    ["DeveloperTaskDetail", developerTasksRouter],
  ] as const)(
    "documents a nullable, not deprecated owner on %s",
    (name, router) => {
      const schema = componentSchemas(router)[name] as {
        properties: Record<string, { deprecated?: boolean }>;
        required: string[];
      };

      expect(schema.properties.owner).toBeDefined();
      expect(schema.properties.owner?.deprecated).toBeUndefined();
      expect(JSON.stringify(schema.properties.owner)).toContain('"null"');
      expect(schema.properties).not.toHaveProperty("responsibleUser");
      expect(schema.required).toContain("owner");
    },
  );
});
