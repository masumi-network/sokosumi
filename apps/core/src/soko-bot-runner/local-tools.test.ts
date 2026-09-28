import { describe, expect, it } from "vitest";

import {
  htmlToText,
  runCommand,
  WORKSPACE,
  workspacePath,
} from "./local-tools";

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

describe("commands", () => {
  it("kills a whole pipeline on timeout, not just bash", async () => {
    const started = Date.now();
    const result = await runCommand({
      command: "sleep 30 | cat",
      timeoutSeconds: 1,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.stderr).toContain("[killed after 1s]");
  });
});
