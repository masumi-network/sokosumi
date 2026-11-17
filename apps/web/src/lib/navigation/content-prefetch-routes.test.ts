import { describe, expect, it } from "vitest";

import { canPrefetchRouteContent } from "./content-prefetch-routes";

describe("canPrefetchRouteContent", () => {
  it.each([
    ["/tasks", true],
    ["/tasks?view=list&assignee=me", true],
    ["/calendar?date=2026-11-19&view=week", true],
    ["/ads?projectId=p1&tab=campaigns", true],
    ["/", true],
    ["/?projectId=p1", true],
    ["/tasks/task-1", false],
    ["/drive?view=workspace", false],
    ["/agents/agent-1", false],
  ])("%s → %s", (href, expected) => {
    expect(canPrefetchRouteContent(href)).toBe(expected);
  });
});
