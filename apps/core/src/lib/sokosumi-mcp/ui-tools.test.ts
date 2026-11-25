import { MCP_UI } from "@sokosumi/mcp-ui";
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

  it("warns before a UI tool whose twin spends credits", () => {
    const spending = new Set(
      MCP_TOOLS.filter((tool) => tool.spendsCredits).map((tool) => tool.name),
    );
    for (const tool of MCP_UI_TOOLS.filter(({ data }) => spending.has(data))) {
      expect(tool.description, tool.name).toMatch(
        /^Spends workspace credits\./,
      );
    }
  });

  it("ships no tool for the placeholder view", () => {
    expect(MCP_UI_TOOLS.map((tool) => tool.ui)).not.toContain("hello");
  });
});

describe("viewIdOf", () => {
  it("reads every view's id from its URI", () => {
    for (const [id, view] of Object.entries(MCP_UI)) {
      expect(viewIdOf(view.uri)).toBe(id);
    }
  });

  it("reads the id whatever the hash", () => {
    expect(viewIdOf("ui://sokosumi/task-board.b3332f14.html")).toBe(
      "task-board",
    );
    expect(viewIdOf("ui://sokosumi/hello.00000000.html")).toBe("hello");
    expect(viewIdOf("ui://sokosumi/task_board.00000000.html")).toBe(
      "task_board",
    );
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
