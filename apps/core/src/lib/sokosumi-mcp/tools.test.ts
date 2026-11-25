import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOOLSETS,
  MCP_TOOLS,
  MCP_TOOLSETS,
  selectToolsets,
  toolsetOf,
} from "./tools";

describe("selectToolsets", () => {
  it("turns on the default toolsets when the URL names none", () => {
    expect(selectToolsets(undefined)).toEqual({ toolsets: DEFAULT_TOOLSETS });
    expect(MCP_TOOLSETS).toEqual(expect.arrayContaining([...DEFAULT_TOOLSETS]));
  });

  it("reads comma-separated and repeated values, once each", () => {
    expect(selectToolsets(["tasks, jobs", "tasks", "vendors"])).toEqual({
      toolsets: ["tasks", "jobs", "vendors"],
    });
  });

  it("names an unknown toolset and lists the real ones", () => {
    expect(selectToolsets(["tasks,ads"])).toEqual({
      error: `Unknown toolset "ads". Toolsets: ${MCP_TOOLSETS.join(", ")}.`,
    });
  });

  it("refuses an empty selection", () => {
    expect(selectToolsets([" , "])).toEqual({
      error: `Name at least one toolset. Toolsets: ${MCP_TOOLSETS.join(", ")}.`,
    });
  });
});

describe("toolsetOf", () => {
  it("is the route group the name starts with", () => {
    expect(toolsetOf("tasks_list")).toBe("tasks");
    expect(toolsetOf("projects_image_studio")).toBe("projects");
  });

  it("keeps a hyphenated route group whole", () => {
    expect(toolsetOf("image_studio_catalog")).toBe("image-studio");
  });
});

describe("tools that spend credits", () => {
  it("say so first", () => {
    for (const tool of MCP_TOOLS.filter((tool) => tool.spendsCredits)) {
      expect(tool.description, tool.name).toMatch(
        /^Spends workspace credits\. /,
      );
    }
  });

  it("include every Image Studio start, and not its cancel (ADR 0077)", () => {
    const spends = (operation: string) =>
      MCP_TOOLS.find((tool) => tool.operation === operation)?.spendsCredits;

    for (const kind of [
      "jobs",
      "video-jobs",
      "short-video-jobs",
      "talking-video-jobs",
    ]) {
      expect(spends(`POST /projects/{id}/image-studio/${kind}`), kind).toBe(
        true,
      );
    }
    const cancel = MCP_TOOLS.find(
      (tool) =>
        tool.operation ===
        "POST /projects/{id}/image-studio/jobs/{jobId}/cancel",
    );
    expect(cancel).toBeDefined();
    expect(cancel?.spendsCredits).toBeFalsy();
  });
});
