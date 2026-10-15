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

// `owner` stays and carries the responsible person; `responsibleUser`
// replaces it (ADR 0056).
describe("admin and developer task OpenAPI contract", () => {
  it.each([
    ["AdminTaskListItem", adminTasksRouter],
    ["AdminTaskDetail", adminTasksRouter],
    ["DeveloperTaskListItem", developerTasksRouter],
    ["DeveloperTaskDetail", developerTasksRouter],
  ] as const)(
    "marks owner of %s deprecated in favour of responsibleUser",
    (name, router) => {
      const schema = componentSchemas(router)[name] as {
        properties: Record<
          string,
          { deprecated?: boolean; description?: string }
        >;
        required: string[];
      };

      expect(schema.properties.owner).toMatchObject({
        deprecated: true,
        description: "Deprecated. Use responsibleUser.",
      });
      expect(schema.properties.responsibleUser).toBeDefined();
      expect(schema.properties.responsibleUser?.deprecated).toBeUndefined();
      expect(schema.required).toEqual(
        expect.arrayContaining(["owner", "responsibleUser"]),
      );
    },
  );
});
