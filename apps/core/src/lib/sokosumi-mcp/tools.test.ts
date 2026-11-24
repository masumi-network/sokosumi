import { describe, expect, it } from "vitest";

import { DEFAULT_TOOLSETS, MCP_TOOLSETS, selectToolsets } from "./tools";

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
