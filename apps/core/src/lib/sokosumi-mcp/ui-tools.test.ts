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

  it("tells agents how to fill the Task board", () => {
    const board = MCP_UI_TOOLS.find((tool) => tool.name === "tasks_show_board");

    expect(board?.description).toContain("`limit: 100`");
    expect(board?.description).toContain(
      '`scope: "workspace"` when the person asks for the team',
    );
  });

  it("shows the hire form on agents_input_schema, which spends nothing itself", () => {
    const hire = MCP_UI_TOOLS.find((tool) => tool.name === "agents_show_hire");
    const twin = MCP_TOOLS.find((tool) => tool.name === hire?.data);

    expect(hire).toMatchObject({
      data: "agents_input_schema",
      ui: "agents-hire",
    });
    expect(twin?.spendsCredits).toBeFalsy();
    expect(hire?.description).toContain("capped at the price shown");
  });

  it("shows the Social posts that need approval, with cancel and no approve (ADR 0077)", () => {
    const show = MCP_UI_TOOLS.find(
      (tool) => tool.name === "workspaces_show_social_posts",
    );

    expect(show).toMatchObject({
      data: "workspaces_social_posts",
      ui: "social-posts",
    });
    expect(show?.description).toContain('`status: "NEEDS_APPROVAL"`');
    expect(show?.description).toContain("projects_social_post_cancel");
    expect(show?.description).toContain("social toolset");
    expect(show?.description).toContain("approves and publishes in Sokosumi");
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
