import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function detailShellClass(source: string): string {
  const match = source.match(/className="(mx-auto max-w-4xl[^"]*)"/);
  if (!match) {
    throw new Error("No task detail shell className found");
  }
  return match[1];
}

describe("task detail padding parity contract", () => {
  it("loading skeleton shell matches loaded TaskDetailView shell", () => {
    const loading = readFileSync(
      path.join(appDir, "[taskId]/loading.tsx"),
      "utf8",
    );
    const view = readFileSync(
      path.join(appDir, "components/task-detail-view.tsx"),
      "utf8",
    );

    expect(detailShellClass(loading)).toBe(detailShellClass(view));
  });
});
