import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getHistoryItemHref } from "@/app/history/utils/history-item-href";
import {
  type HistoryItem,
  SokosumiJobStatus,
  TaskStatus,
} from "@/lib/clients/generated/core";

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("getHistoryItemHref", () => {
  it("maps task and job rows to History destinations", () => {
    const task: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Ship restyle",
      description: null,
      updatedAt: new Date("2026-05-27T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      owner: null,
      status: TaskStatus.INPUT_REQUIRED,
      projectId: "project-1",
      coworkerId: null,
      sokoBotId: null,
    };
    const job: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Generate assets",
      description: null,
      updatedAt: new Date("2026-05-27T11:00:00.000Z"),
      archivedAt: null,
      credits: null,
      owner: null,
      status: SokosumiJobStatus.PAYMENT_FAILED,
      projectId: "project-1",
      agentId: "agent-1",
      agentName: "Designer",
      agentIcon: null,
    };

    expect(getHistoryItemHref(task)).toBe("/tasks/task-1");
    expect(getHistoryItemHref(job)).toBe("/agents/agent-1/jobs/job-1");
  });

  it("lives in a server-safe module (SOK-990 / SOKOSUMI-RW)", () => {
    const hrefModule = stripComments(
      readFileSync(join(here, "history-item-href.ts"), "utf8"),
    );
    expect(hrefModule).not.toMatch(/["']use client["']/);

    const needsAttention = stripComments(
      readFileSync(
        join(
          here,
          "../../projects/components/project-needs-attention-section.tsx",
        ),
        "utf8",
      ),
    );
    expect(needsAttention).not.toMatch(/["']use client["']/);
    expect(needsAttention).toMatch(
      /getHistoryItemHref[\s\S]*from\s+["']@\/app\/history\/utils\/history-item-href["']/,
    );
    expect(needsAttention).not.toMatch(
      /getHistoryItemHref[\s\S]*from\s+["']@\/app\/history\/components\/history-list-item["']/,
    );
  });
});
