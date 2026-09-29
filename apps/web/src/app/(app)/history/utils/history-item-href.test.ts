import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TransactionHistoryItem } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { getHistoryItemHref } from "@/app/history/utils/history-item-href";

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const base = {
  consumedAt: new Date("2026-05-27T10:00:00.000Z"),
  credits: 3,
  description: null,
  owner: null,
  projectId: "project-1",
} as const;

describe("getHistoryItemHref", () => {
  it("maps task, job and image consumptions to their destinations", () => {
    const task: TransactionHistoryItem = {
      ...base,
      kind: "task",
      id: "tx-1",
      title: "Ship restyle",
      taskId: "task-1",
      taskEventId: "event-1",
    };
    const job: TransactionHistoryItem = {
      ...base,
      kind: "job",
      id: "tx-2",
      title: "Generate assets",
      jobId: "job-1",
      agentId: "agent-1",
      agentName: "Designer",
      agentIcon: null,
    };
    const image: TransactionHistoryItem = {
      ...base,
      kind: "image",
      id: "tx-3",
      title: "A bold event poster",
      imageJobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      modelLabel: "Gemini 3.1 Flash Image",
    };

    expect(getHistoryItemHref(task)).toBe("/tasks/task-1");
    expect(getHistoryItemHref(job)).toBe("/agents/agent-1/jobs/job-1");
    expect(getHistoryItemHref(image)).toBe("/studio?projectId=project-1");
  });

  it("has no destination for a consumption with no page behind it", () => {
    const coworker: TransactionHistoryItem = {
      ...base,
      kind: "coworker",
      id: "tx-4",
      title: "Ledger Coworker",
      projectId: null,
      coworkerId: "cow-1",
    };
    const sokoBot: TransactionHistoryItem = {
      ...base,
      kind: "sokoBot",
      id: "tx-5",
      title: "Soko Bot usage",
      projectId: null,
      sokoBotId: "01960001-0001-7001-8001-000000000099",
    };
    const unattributed: TransactionHistoryItem = {
      ...base,
      kind: "unattributed",
      id: "tx-6",
      title: "Credit consumption",
      projectId: null,
      bucketSource: null,
    };

    expect(getHistoryItemHref(coworker)).toBeNull();
    expect(getHistoryItemHref(sokoBot)).toBeNull();
    expect(getHistoryItemHref(unattributed)).toBeNull();
  });

  it("lives in a server-safe module (SOK-990 / SOKOSUMI-RW)", () => {
    // Both callers are client components today — the needs-attention section
    // that was the server one is gone with the project workspace tiles. The
    // module stays free of "use client" anyway: that is what lets the next
    // server component render a history row without pulling a client boundary
    // in behind it, which is the regression SOK-990 fixed.
    const hrefModule = stripComments(
      readFileSync(join(here, "history-item-href.ts"), "utf8"),
    );
    expect(hrefModule).not.toMatch(/["']use client["']/);
  });
});
