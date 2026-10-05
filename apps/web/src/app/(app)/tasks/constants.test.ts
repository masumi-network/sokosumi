import { describe, expect, it } from "vitest";
import {
  TASK_DETAIL_CONTEXT_STRIP_CLASS,
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_MAIN_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";

describe("task detail layout constants", () => {
  it("shell is a centered max-w-[80rem] container with task padding", () => {
    const shell = TASK_DETAIL_SHELL_CLASS.split(/\s+/);

    expect(shell).toContain("mx-auto");
    expect(shell).toContain("w-full");
    expect(shell).toContain("max-w-[80rem]");
    expect(shell).not.toContain("max-w-6xl");
    expect(shell).toContain("pb-8");
    expect(shell).toContain("md:px-4");
    expect(shell).not.toContain("max-w-4xl");
  });

  it("grid uses the xl two-column tokens with a clamped sidebar", () => {
    expect(TASK_DETAIL_GRID_CLASS).toContain("grid-cols-1");
    expect(TASK_DETAIL_GRID_CLASS).toContain(
      "xl:grid-cols-[minmax(0,1fr)_clamp(18rem,32%,25rem)]",
    );
    expect(TASK_DETAIL_GRID_CLASS).toContain("gap-8");
    expect(TASK_DETAIL_GRID_CLASS).toContain("xl:gap-x-14");
    expect(TASK_DETAIL_MAIN_CLASS).toBe("min-w-0 space-y-8");
    expect(TASK_DETAIL_SIDEBAR_CLASS).toContain("xl:col-start-2");
    expect(TASK_DETAIL_SIDEBAR_CLASS).toContain("xl:row-span-2");
    expect(TASK_DETAIL_CONTEXT_STRIP_CLASS).toContain("max-w-[80rem]");
    expect(TASK_DETAIL_CONTEXT_STRIP_CLASS).not.toContain("max-w-6xl");
    expect(TASK_DETAIL_CONTEXT_STRIP_CLASS).not.toContain("max-w-4xl");
  });
});
