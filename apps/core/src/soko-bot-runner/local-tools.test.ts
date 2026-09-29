import { describe, expect, it } from "vitest";

import { htmlToText, WORKSPACE, workspacePath } from "./local-tools";

describe("workspace paths", () => {
  it("resolves paths inside the workspace", () => {
    expect(workspacePath("notes/a.md")).toBe(`${WORKSPACE}/notes/a.md`);
    expect(workspacePath()).toBe(WORKSPACE);
  });

  it.each(["../escape.txt", "/etc/passwd", "notes/../../x"])(
    "refuses %s",
    (path) => {
      expect(() => workspacePath(path)).toThrow("outside the workspace");
    },
  );
});

describe("html to text", () => {
  it("decodes entities once", () => {
    expect(htmlToText("<p>a &amp;lt; b &lt; c</p>")).toBe("a &lt; b < c");
  });
});
