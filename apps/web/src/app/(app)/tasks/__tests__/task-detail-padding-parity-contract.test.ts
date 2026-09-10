import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TASK_DETAIL_SHELL_CLASS } from "@/app/tasks/constants";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("task detail padding parity contract", () => {
  it("loading skeleton shell matches loaded TaskDetailView shell constant", () => {
    const loading = readFileSync(
      path.join(appDir, "[taskId]/loading.tsx"),
      "utf8",
    );
    const view = readFileSync(
      path.join(appDir, "components/task-detail-view.tsx"),
      "utf8",
    );

    expect(loading).toContain("TASK_DETAIL_SHELL_CLASS");
    expect(view).toContain("TASK_DETAIL_SHELL_CLASS");
    expect(TASK_DETAIL_SHELL_CLASS).toContain("max-w-6xl");
    expect(TASK_DETAIL_SHELL_CLASS).toContain("pb-8");
    expect(TASK_DETAIL_SHELL_CLASS).toContain("md:px-4");
    expect(TASK_DETAIL_SHELL_CLASS.split(/\s+/)).not.toContain("px-2");
  });
});
