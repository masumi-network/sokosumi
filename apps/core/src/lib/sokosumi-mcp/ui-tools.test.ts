import { describe, expect, it } from "vitest";

import { MCP_TOOLS } from "./tools";
import { MCP_UI_TOOLS, viewIdOf } from "./ui-tools";

describe("MCP_UI_TOOLS", () => {
  it("names a data twin and a name of its own", () => {
    const dataTools = new Set(MCP_TOOLS.map((tool) => tool.name));
    const names = MCP_UI_TOOLS.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    for (const tool of MCP_UI_TOOLS) {
      expect(dataTools.has(tool.data), tool.name).toBe(true);
      expect(dataTools.has(tool.name), tool.name).toBe(false);
    }
  });

  it("ships no tool for the placeholder view", () => {
    expect(MCP_UI_TOOLS.map((tool) => tool.ui)).not.toContain("hello");
  });
});

describe("viewIdOf", () => {
  it("reads the id whatever the hash", () => {
    expect(viewIdOf("ui://sokosumi/task-board.b3332f14.html")).toBe(
      "task-board",
    );
    expect(viewIdOf("ui://sokosumi/hello.00000000.html")).toBe("hello");
  });

  it("refuses anything else", () => {
    for (const uri of [
      "ui://sokosumi/hello.html",
      "ui://sokosumi/hello.b3332f1.html",
      "ui://other/hello.b3332f14.html",
      "ui://sokosumi/../hello.b3332f14.html",
      "https://sokosumi.com/hello.b3332f14.html",
    ]) {
      expect(viewIdOf(uri), uri).toBeUndefined();
    }
  });
});
