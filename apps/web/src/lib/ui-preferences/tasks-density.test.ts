import { describe, expect, it } from "vitest";
import { parseTasksDensityCookieHeader } from "@/lib/ui-preferences/tasks-density";

describe("parseTasksDensityCookieHeader", () => {
  it("ignores a cookie whose name only ends in tasks_density", () => {
    expect(
      parseTasksDensityCookieHeader("old_tasks_density=compact"),
    ).toBeNull();
  });
});
