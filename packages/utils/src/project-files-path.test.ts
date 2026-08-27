import { describe, expect, it } from "vitest";

import {
  buildProjectBriefingPathname,
  buildProjectContextMdPathname,
  buildProjectFilesPrefix,
  buildProjectFilesRootPrefix,
} from "./project-files-path.js";

describe("project file path builders", () => {
  it("builds the project root and tokenized prefixes", () => {
    expect(buildProjectFilesRootPrefix("project_123")).toBe(
      "projects/project_123/",
    );
    expect(buildProjectFilesPrefix("project_123", "secret_token")).toBe(
      "projects/project_123/secret_token/",
    );
  });

  it("builds tokenized project-scoped markdown paths", () => {
    expect(buildProjectBriefingPathname("project_123", "secret_token")).toBe(
      "projects/project_123/secret_token/BRIEFING.md",
    );
    expect(buildProjectContextMdPathname("project_123", "secret_token")).toBe(
      "projects/project_123/secret_token/CONTEXT.md",
    );
  });
});
