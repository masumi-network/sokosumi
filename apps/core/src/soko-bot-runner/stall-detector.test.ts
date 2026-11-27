import { describe, expect, it } from "vitest";
import {
  canonicalDigest,
  STALL_ALTERNATING_LENGTH,
  STALL_POLL_NO_PROGRESS_THRESHOLD,
  STALL_REPEAT_THRESHOLD,
  stallBlockedPrompt,
  stallNudgePrompt,
  TurnStallDetector,
} from "./stall-detector";

describe("TurnStallDetector (E8)", () => {
  const readFile = (path: string) => ({
    toolName: "read_file",
    input: { path },
    output: { text: path },
  });

  it("preserves productive status checks while consulting the same task list (order-independent) and still catches unchanged polls", () => {
    for (const sameTarget of [false, true]) {
      for (const reverse of [false, true]) {
        const detector = new TurnStallDetector();
        for (let i = 1; i <= 8; i++) {
          const statusCall = {
            toolName: "get_task_status",
            input: { taskId: sameTarget ? "t" : `t${i}` },
            output: { status: "RUNNING", events: [{ id: `e${i}` }] },
          };
          const listCall = {
            toolName: "list_tasks",
            input: { projectId: "project" },
            output: { total: 8 },
          };
          const toolResults = reverse
            ? [listCall, statusCall]
            : [statusCall, listCall];
          const hit = detector.observeSteps([{ toolResults }], 0);
          expect(hit).toBeNull();
        }
      }
    }

    // Unchanged polls alongside the same task list must still trigger poll_no_progress on step 3.
    const stalled = new TurnStallDetector();
    const unchangedPoll = {
      toolName: "get_task_status",
      input: { taskId: "t" },
      output: { status: "RUNNING", events: [{ id: "e1" }] },
    };
    const listCall = {
      toolName: "list_tasks",
      input: { projectId: "project" },
      output: { total: 8 },
    };
    expect(
      stalled.observeSteps([{ toolResults: [unchangedPoll, listCall] }], 0),
    ).toBeNull();
    expect(
      stalled.observeSteps([{ toolResults: [unchangedPoll, listCall] }], 0),
    ).toBeNull();
    expect(
      stalled.observeSteps([{ toolResults: [unchangedPoll, listCall] }], 0),
    ).toEqual({
      pattern: "poll_no_progress",
      tools: ["get_task_status"],
      count: STALL_POLL_NO_PROGRESS_THRESHOLD,
    });
  });

  it("allows repeated reference to an index while previously unread files are opened", () => {
    const detector = new TurnStallDetector();
    for (let i = 0; i < 8; i++) {
      expect(detector.observeCall(readFile(`chapter-${i}`))).toBeNull();
      expect(detector.observeCall(readFile("index"))).toBeNull();
    }
  });

  it("processes the whole completed parallel step before deciding a stall regardless of result order", () => {
    const save = {
      toolName: "create_task",
      input: { title: "draft" },
      output: { id: "new-task" },
    };
    for (const resultOrder of [
      [readFile("index"), save],
      [save, readFile("index")],
    ]) {
      const detector = new TurnStallDetector();
      for (let i = 0; i < 3; i++) detector.observeCall(readFile("index"));
      expect(
        detector.observeSteps([{ toolResults: resultOrder }], 0),
      ).toBeNull();
    }

    // Same order-independence for a 3rd unchanged poll paired with a new write.
    const poll = {
      toolName: "get_task_status",
      input: { taskId: "t1" },
      output: { status: "RUNNING" },
    };
    for (const resultOrder of [
      [poll, save],
      [save, poll],
    ]) {
      const detector = new TurnStallDetector();
      expect(detector.observeCall(poll)).toBeNull();
      expect(detector.observeCall(poll)).toBeNull();
      expect(
        detector.observeSteps([{ toolResults: resultOrder }], 0),
      ).toBeNull();
    }
  });

  it("flags repeat_same on the 4th identical successful call (key-order independent) and ignores errors", () => {
    const detector = new TurnStallDetector();

    // Errored results are ignored (left to failure breakers / typed tool errors).
    for (let i = 0; i < 6; i++) {
      expect(
        detector.observeCall({
          toolName: "list_tasks",
          input: { state: "open" },
          output: { isError: true, message: "temporary" },
        }),
      ).toBeNull();
    }

    for (let i = 0; i < STALL_REPEAT_THRESHOLD - 1; i++) {
      expect(
        detector.observeCall({
          toolName: "list_tasks",
          input:
            i % 2 === 0
              ? { state: "open", limit: 10 }
              : { limit: 10, state: "open" },
          output: { tasks: [{ id: "t1", status: "RUNNING" }] },
        }),
      ).toBeNull();
    }

    const hit = detector.observeCall({
      toolName: "list_tasks",
      input: { limit: 10, state: "open" },
      output: { tasks: [{ id: "t1", status: "RUNNING" }] },
    });
    expect(hit).toEqual({
      pattern: "repeat_same",
      tools: ["list_tasks"],
      count: 4,
    });
  });

  it("flags alternating_ab at 6 calls (3 pairs) and never false-positives on 4 calls (2 pairs)", () => {
    const detector = new TurnStallDetector();
    const callA = {
      toolName: "get_posting_instructions",
      input: { network: "X" },
      output: { maxChars: 280 },
    };
    const callB = {
      toolName: "list_social_posts",
      input: { limit: 5 },
      output: { posts: [] },
    };

    // 4 calls (2 pairs): must NOT fire (matches passing dev journey calibration).
    expect(detector.observeCall(callA)).toBeNull();
    expect(detector.observeCall(callB)).toBeNull();
    expect(detector.observeCall(callA)).toBeNull();
    expect(detector.observeCall(callB)).toBeNull();

    // 5th call still below 6.
    expect(detector.observeCall(callA)).toBeNull();
    // 6th call completes A-B-A-B-A-B -> fires!
    const hit = detector.observeCall(callB);
    expect(hit).toEqual({
      pattern: "alternating_ab",
      tools: ["get_posting_instructions", "list_social_posts"],
      count: STALL_ALTERNATING_LENGTH,
    });
  });

  it("flags poll_no_progress on 3 unchanged status polls even across volatile timestamps and bash sleep", () => {
    const detector = new TurnStallDetector();
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "task-1" },
        output: { status: "RUNNING", checkedAt: "2026-11-27T01:00:00Z" },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "bash",
        input: { command: "sleep 120" },
        output: { exitCode: 0, stdout: "" },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "task-1" },
        output: { status: "RUNNING", checkedAt: "2026-11-27T01:02:00Z" },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "bash",
        input: { command: "sleep 120" },
        output: { exitCode: 0, stdout: "" },
      }),
    ).toBeNull();

    const hit = detector.observeCall({
      toolName: "get_task_status",
      input: { taskId: "task-1" },
      output: { status: "RUNNING", checkedAt: "2026-11-27T01:04:00Z" },
    });
    expect(hit).toEqual({
      pattern: "poll_no_progress",
      tools: ["get_task_status"],
      count: STALL_POLL_NO_PROGRESS_THRESHOLD,
    });
  });

  it("flags 3 consecutive bash sleep commands with varying durations", () => {
    const detector = new TurnStallDetector();
    expect(
      detector.observeCall({
        toolName: "bash",
        input: { command: "sleep 60" },
        output: { exitCode: 0 },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "bash",
        input: { command: "sleep 120" },
        output: { exitCode: 0 },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "bash",
        input: { command: "sleep 180" },
        output: { exitCode: 0 },
      }),
    ).toEqual({
      pattern: "poll_no_progress",
      tools: ["bash"],
      count: 3,
    });
  });

  it("never false-positives on slow progressing polls, multi-target reads, or productive batch writes", () => {
    const detector = new TurnStallDetector();

    // 1. Slow Coworker making progress (new event arrives on call 2, completes on call 3).
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "t1" },
        output: { status: "RUNNING", events: [{ id: "e1" }] },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "t1" },
        output: { status: "RUNNING", events: [{ id: "e1" }, { id: "e2" }] },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "t1" },
        output: { status: "RUNNING", events: [{ id: "e1" }, { id: "e2" }] },
      }),
    ).toBeNull();
    expect(
      detector.observeCall({
        toolName: "get_task_status",
        input: { taskId: "t1" },
        output: {
          status: "COMPLETED",
          events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
        },
      }),
    ).toBeNull();

    // 2. Reading 6 distinct tasks in one turn.
    for (let i = 1; i <= 6; i++) {
      expect(
        detector.observeCall({
          toolName: "get_task_status",
          input: { taskId: `distinct-${i}` },
          output: { status: "RUNNING" },
        }),
      ).toBeNull();
    }

    // 3. Productive batch loop: same read before 5 distinct writes.
    for (let i = 1; i <= 5; i++) {
      expect(
        detector.observeCall({
          toolName: "get_posting_instructions",
          input: { network: "X" },
          output: { maxChars: 280 },
        }),
      ).toBeNull();
      expect(
        detector.observeCall({
          toolName: "create_social_post",
          input: { text: `Post ${i}` },
          output: { id: `post-${i}`, status: "NEEDS_APPROVAL" },
        }),
      ).toBeNull();
    }
  });

  it("still catches 4 identical mutating writes returning the exact same result", () => {
    const detector = new TurnStallDetector();
    const call = {
      toolName: "update_social_post",
      input: { id: "p1", text: "Same text" },
      output: { id: "p1", updated: true },
    };
    expect(detector.observeCall(call)).toBeNull();
    expect(detector.observeCall(call)).toBeNull();
    expect(detector.observeCall(call)).toBeNull();
    expect(detector.observeCall(call)).toEqual({
      pattern: "repeat_same",
      tools: ["update_social_post"],
      count: 4,
    });
  });

  it("catches alternating bash commands and alternating identical domain writes", () => {
    const bashDetector = new TurnStallDetector();
    const ls = {
      toolName: "bash",
      input: { command: "ls" },
      output: { exitCode: 0, stdout: "a.txt\n" },
    };
    const pwd = {
      toolName: "bash",
      input: { command: "pwd" },
      output: { exitCode: 0, stdout: "/work\n" },
    };
    for (let i = 0; i < 5; i++) {
      expect(bashDetector.observeCall(i % 2 === 0 ? ls : pwd)).toBeNull();
    }
    expect(bashDetector.observeCall(pwd)).toEqual({
      pattern: "alternating_ab",
      tools: ["bash"],
      count: 6,
    });

    const writeDetector = new TurnStallDetector();
    const writeA = {
      toolName: "update_social_post",
      input: { id: "p1", text: "A" },
      output: { id: "p1", ok: true },
    };
    const writeB = {
      toolName: "update_social_post",
      input: { id: "p1", text: "B" },
      output: { id: "p1", ok: true },
    };
    for (let i = 0; i < 5; i++) {
      expect(
        writeDetector.observeCall(i % 2 === 0 ? writeA : writeB),
      ).toBeNull();
    }
    expect(writeDetector.observeCall(writeB)).toEqual({
      pattern: "alternating_ab",
      tools: ["update_social_post"],
      count: 6,
    });
  });

  it("canonicalDigest strips volatile keys only when stripVolatile is true", () => {
    const a = { status: "RUNNING", checkedAt: "2026-11-27T01:00:00Z" };
    const b = { checkedAt: "2026-11-27T01:05:00Z", status: "RUNNING" };
    expect(canonicalDigest(a, true)).toBe(canonicalDigest(b, true));
    expect(canonicalDigest(a, false)).not.toBe(canonicalDigest(b, false));
  });

  it("formats clear corrective and blocked prompts that preserve registered watches", () => {
    const detection = {
      pattern: "poll_no_progress" as const,
      tools: ["get_task_status"],
      count: 3,
    };
    const nudge = stallNudgePrompt(detection, {
      background: true,
      hasWaitFor: true,
      hasUpdatePlan: true,
    });
    expect(nudge).toContain("get_task_status");
    expect(nudge).toContain("wait_for");
    expect(nudge).toContain("update_plan");
    expect(nudge).toContain("DONE:");

    const blocked = stallBlockedPrompt(detection, true);
    expect(blocked).toContain("DONE:");
    expect(blocked).toContain("watch or follow-up remains in place");
  });
});
