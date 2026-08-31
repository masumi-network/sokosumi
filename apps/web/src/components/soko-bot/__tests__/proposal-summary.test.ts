import { describe, expect, it } from "vitest";

import {
  formatRedactedValue,
  isHireProposalAcceptable,
  REDACTED_VALUE,
  redactProposalValue,
  summarizeProposal,
} from "../proposal-summary";

describe("proposal summary", () => {
  it("shows agent, credit ceiling and input for a hire proposal", () => {
    const summary = summarizeProposal("hire_agent", {
      agentId: "agent_123",
      maxCredits: 25,
      name: "Launch research",
      inputData: { brief: "Research launch risks", depth: 2 },
      inputSchema: { type: "object" },
    });
    expect(summary.acceptable).toBe(true);
    expect(summary.fields.map((f) => [f.key, f.value])).toEqual([
      ["agentId", "agent_123"],
      ["maxCredits", "25"],
      ["name", "Launch research"],
      ["inputData", "brief: Research launch risks · depth: 2"],
    ]);
    // Non-typed remainder is still surfaced (redacted), never hidden.
    expect(formatRedactedValue(summary.raw ?? null)).toContain("inputSchema");
  });

  it("recursively masks credential-looking keys and caps size", () => {
    const redacted = redactProposalValue({
      apiKey: "sk-live-123",
      nested: { Authorization: "Bearer x", password: "p", ok: "fine" },
      card: { number: "4111" },
      payment_token: "tok",
      list: [1, 2, 3, 4, 5, 6, 7],
      long: "x".repeat(500),
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain("sk-live-123");
    expect(text).not.toContain("Bearer x");
    expect(text).not.toContain("4111");
    expect(text).not.toContain('tok"');
    expect(text).toContain(REDACTED_VALUE);
    expect((redacted as { nested: { ok: string } }).nested.ok).toBe("fine");
    expect((redacted as { list: unknown[] }).list).toHaveLength(6); // 5 + "…"
    expect((redacted as { long: string }).long.length).toBeLessThanOrEqual(160);
  });

  it("marks hire proposals without agent or positive ceiling as unacceptable", () => {
    expect(isHireProposalAcceptable({ agentId: "a", maxCredits: 5 })).toBe(
      true,
    );
    expect(isHireProposalAcceptable({ agentId: "", maxCredits: 5 })).toBe(
      false,
    );
    expect(isHireProposalAcceptable({ agentId: "a", maxCredits: 0 })).toBe(
      false,
    );
    expect(isHireProposalAcceptable({ agentId: "a" })).toBe(false);
    expect(isHireProposalAcceptable(null)).toBe(false);
    expect(summarizeProposal("hire_agent", { agentId: "a" }).acceptable).toBe(
      false,
    );
    // Non-paid tools stay acceptable regardless of shape.
    expect(summarizeProposal("create_task", {}).acceptable).toBe(true);
  });

  it("summarises task and job-input targets", () => {
    const task = summarizeProposal("assign_task", {
      taskId: "task_1",
      coworkerId: "cw_1",
      status: "READY",
    });
    expect(task.fields.map((f) => f.key)).toEqual([
      "taskId",
      "coworkerId",
      "status",
    ]);
    const input = summarizeProposal("provide_job_input", {
      jobId: "job_1",
      eventId: "evt_1",
      inputData: { secretAnswer: "42", answer: "yes" },
    });
    expect(input.fields.find((f) => f.key === "inputData")?.value).toBe(
      `secretAnswer: ${REDACTED_VALUE} · answer: yes`,
    );
  });
});
