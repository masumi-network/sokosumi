import { describe, expect, it } from "vitest";

import {
  citableSources,
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

describe("citableSources", () => {
  it("counts every search result", () => {
    expect(
      citableSources("web_search", {
        query: "token2049",
        results: [
          {
            results: [
              { url: "https://www.token2049.com/singapore" },
              { url: "https://example.org/a" },
            ],
          },
        ],
      }),
    ).toEqual(["https://www.token2049.com/singapore", "https://example.org/a"]);
  });

  it("counts a fetched page only when it loaded with content", () => {
    const page = { url: "https://example.org/a", contentType: "text/html" };
    expect(
      citableSources("web_fetch", { ...page, status: 200, text: "Dates" }),
    ).toEqual(["https://example.org/a"]);
    expect(
      citableSources("web_fetch", { ...page, status: 403, text: "Denied" }),
    ).toEqual([]);
    expect(
      citableSources("web_fetch", { ...page, status: 202, text: " " }),
    ).toEqual([]);
    expect(citableSources("web_fetch", { error: "timeout" })).toEqual([]);
  });

  it("gives nothing for tools that read no web page", () => {
    expect(citableSources("bash", { stdout: "https://x.example" })).toEqual([]);
  });
});
