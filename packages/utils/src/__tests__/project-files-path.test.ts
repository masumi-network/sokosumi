import { describe, expect, it } from "vitest";

import {
  buildProjectBriefingPathname,
  buildProjectContextMdPathname,
} from "../project-files-path.js";

describe("project file path builders", () => {
  it("builds stable project-scoped markdown paths", () => {
    expect(buildProjectBriefingPathname("project_123")).toBe(
      "projects/project_123/BRIEFING.md",
    );
    expect(buildProjectContextMdPathname("project_123")).toBe(
      "projects/project_123/CONTEXT.md",
    );
  });
});
