import { describe, expect, it } from "vitest";
import { PROJECTS_DETAIL_SHELL_CLASS } from "@/app/projects/constants";
import {
  TASK_DETAIL_CONTEXT_STRIP_CLASS,
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_MAIN_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";

describe("task detail layout constants", () => {
  it("shell matches project detail max-w-6xl width with task padding", () => {
    const shell = TASK_DETAIL_SHELL_CLASS.split(/\s+/);
    const projectShell = PROJECTS_DETAIL_SHELL_CLASS.split(/\s+/);

    expect(shell).toContain("mx-auto");
    expect(shell).toContain("w-full");
    expect(shell).toContain("max-w-6xl");
    expect(shell).toContain("pb-8");
    expect(shell).toContain("md:px-4");
    expect(shell).not.toContain("max-w-4xl");
    expect(projectShell).toContain("max-w-6xl");
  });

  it("grid uses the project-detail xl two-column tokens", () => {
    expect(TASK_DETAIL_GRID_CLASS).toContain("grid-cols-1");
    expect(TASK_DETAIL_GRID_CLASS).toContain(
      "xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]",
    );
    expect(TASK_DETAIL_GRID_CLASS).toContain("gap-8");
    expect(TASK_DETAIL_MAIN_CLASS).toBe("min-w-0 space-y-8");
    expect(TASK_DETAIL_SIDEBAR_CLASS).toContain("xl:col-start-2");
    expect(TASK_DETAIL_SIDEBAR_CLASS).toContain("xl:row-span-2");
    expect(TASK_DETAIL_CONTEXT_STRIP_CLASS).toContain("max-w-6xl");
    expect(TASK_DETAIL_CONTEXT_STRIP_CLASS).not.toContain("max-w-4xl");
  });
});
