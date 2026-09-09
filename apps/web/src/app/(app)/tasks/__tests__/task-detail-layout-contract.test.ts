import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";

const tasksDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const shareViewPath = path.resolve(
  tasksDir,
  "../../share/components/shared-task-view.tsx",
);

function readTasks(...segments: string[]): string {
  return readFileSync(path.join(tasksDir, ...segments), "utf8");
}

describe("task detail layout contract", () => {
  it("auth view and loading skeleton share the max-w-6xl shell constant", () => {
    const loading = readTasks("[taskId]/loading.tsx");
    const view = readTasks("components/task-detail-view.tsx");

    expect(loading).toContain("TASK_DETAIL_SHELL_CLASS");
    expect(view).toContain("TASK_DETAIL_SHELL_CLASS");
    expect(loading).not.toMatch(/className="[^"]*max-w-4xl/);
    expect(view).not.toMatch(/className="[^"]*max-w-4xl/);
    expect(TASK_DETAIL_SHELL_CLASS).toContain("max-w-6xl");
  });

  it("auth and share layouts share the xl two-column grid tokens", () => {
    const view = readTasks("components/task-detail-view.tsx");
    const share = readFileSync(shareViewPath, "utf8");

    expect(view).toContain("TASK_DETAIL_GRID_CLASS");
    expect(share).toContain("TASK_DETAIL_GRID_CLASS");
    expect(TASK_DETAIL_GRID_CLASS).toContain(
      "xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]",
    );
  });

  it("metadata UI no longer renders a Properties section heading", () => {
    const metadata = readTasks("components/task-metadata.tsx");
    const share = readFileSync(shareViewPath, "utf8");

    expect(metadata).not.toContain("propertiesTitle");
    expect(metadata).not.toMatch(
      /tracking-wider uppercase[\s\S]{0,80}properties/i,
    );
    expect(share).not.toContain('tTaskDetail("properties")');
  });

  it("single-column source order keeps metadata after description and before later sections", () => {
    const view = readTasks("components/task-detail-view.tsx");
    const descriptionIdx = view.indexOf("<TaskDescription");
    const metadataIdx = view.indexOf("<TaskMetadata");
    const linkedIdx = view.indexOf("<TaskRelatedTasks");
    const filesIdx = view.indexOf("<TaskFiles");

    expect(descriptionIdx).toBeGreaterThan(-1);
    expect(metadataIdx).toBeGreaterThan(descriptionIdx);
    expect(linkedIdx).toBeGreaterThan(metadataIdx);
    expect(filesIdx).toBeGreaterThan(metadataIdx);
  });

  it("share single-column source order keeps metadata after description and before files", () => {
    const share = readFileSync(shareViewPath, "utf8");
    const descriptionBlockIdx = share.indexOf(
      'className={cn("space-y-4 md:pt-4", APP_MAIN_MOBILE_PT_CLASS)}',
    );
    const sidebarIdx = share.indexOf(
      '<aside className={cn(TASK_DETAIL_SIDEBAR_CLASS, "md:pt-4")}>',
    );
    const filesIdx = share.indexOf("<TaskFiles");

    expect(descriptionBlockIdx).toBeGreaterThan(-1);
    expect(sidebarIdx).toBeGreaterThan(descriptionBlockIdx);
    expect(filesIdx).toBeGreaterThan(sidebarIdx);
  });

  it("share view no longer uses the fixed right aside rail pattern", () => {
    const share = readFileSync(shareViewPath, "utf8");

    expect(share).not.toMatch(/aside[^>]*w-56/);
    expect(share).not.toContain("md:hidden");
    expect(share).not.toContain("sticky top-20");
    expect(share).toContain("TASK_DETAIL_SIDEBAR_CLASS");
  });

  it("share view aside applies md:pt-4 without padding the shared sidebar constant", () => {
    const share = readFileSync(shareViewPath, "utf8");

    expect(share).toContain('cn(TASK_DETAIL_SIDEBAR_CLASS, "md:pt-4")');
    expect(TASK_DETAIL_SIDEBAR_CLASS).not.toContain("pt-");
  });
});
