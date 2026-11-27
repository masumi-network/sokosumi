import { createHash } from "node:crypto";
import { isReadOnlyToolName, isSleepOnlyToolCall } from "./rounds";

/**
 * Deterministic, zero-LLM stall detector for loops whose tool calls succeed
 * without making progress (E8 / research2 R2-A).
 *
 * Calibrated offline against 162 completed + 47 Batch 1 ownerbench results
 * (623 stored DB turns) for 0 false positives on passing runs:
 * - `repeat_same`: 4 identical successful calls within the last 20 calls
 * - `alternating_ab`: 6 consecutive alternating calls (A-B-A-B-A-B; len=4 had
 *   a false positive on a passing journey)
 * - `poll_no_progress`: 3 unchanged polls of the same status target (including
 *   when interleaved with `bash sleep`) or 3 consecutive `bash sleep` waits
 *   with no intervening state change or new write receipt.
 *
 * Failed/errored tool calls are ignored here so identical-failure recovery
 * stays with typed tool errors and failure breakers.
 */

export const STALL_WINDOW_SIZE = 20;
export const STALL_REPEAT_THRESHOLD = 4;
export const STALL_ALTERNATING_LENGTH = 6;
export const STALL_POLL_NO_PROGRESS_THRESHOLD = 3;

export const POLL_STATUS_TOOLS: ReadonlySet<string> = new Set([
  "get_task_status",
  "get_job_status",
  "get_image",
  "get_video",
]);

/** Purely volatile metadata fields stripped when comparing status-poll outputs. */
const VOLATILE_POLL_KEYS: ReadonlySet<string> = new Set([
  "checkedAt",
  "fetchedAt",
  "now",
  "serverTime",
  "timestamp",
  "elapsedMs",
  "requestId",
  "traceId",
]);

/** Non-domain bookkeeping calls that must not clear a stalled poll/read loop. */
const NON_PROGRESS_TOOLS: ReadonlySet<string> = new Set(["update_plan"]);

export type StallPattern =
  | "repeat_same"
  | "alternating_ab"
  | "poll_no_progress";

export interface StallDetection {
  pattern: StallPattern;
  tools: readonly string[];
  count: number;
}

export interface TurnStallEvent extends StallDetection {
  strike: number;
  action: "nudged" | "stopped";
}

export interface ObservedToolResult {
  toolName: string;
  input: unknown;
  output: unknown;
}

interface WindowEntry {
  toolName: string;
  signature: string;
  isDomainWrite: boolean;
}

function canonicalize(
  value: unknown,
  stripVolatile: boolean,
  depth = 0,
): unknown {
  if (depth >= 8) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 8_000
      ? `${value.slice(0, 8_000)}#[len=${value.length}]`
      : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, stripVolatile, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (stripVolatile && VOLATILE_POLL_KEYS.has(key)) continue;
    sorted[key] = canonicalize(record[key], stripVolatile, depth + 1);
  }
  return sorted;
}

export function canonicalDigest(value: unknown, stripVolatile = false): string {
  const serialized =
    JSON.stringify(canonicalize(value, stripVolatile)) ?? String(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function isErrorResultOutput(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  if ("isError" in output && output.isError === true) return true;
  if (
    "type" in output &&
    typeof output.type === "string" &&
    output.type.startsWith("error")
  ) {
    return true;
  }
  return false;
}

export class TurnStallDetector {
  private window: WindowEntry[] = [];
  private seenSignatures = new Set<string>();
  private redundantCounts = new Map<string, number>();
  private pollTargets = new Map<
    string,
    { outputDigest: string; streak: number }
  >();
  private sleepStreak = 0;
  private strikes = 0;

  get strikeCount(): number {
    return this.strikes;
  }

  recordStrike(): number {
    this.strikes += 1;
    return this.strikes;
  }

  /** Clears recent call state after a Strike 1 nudge while keeping strike count. */
  resetWindow(): void {
    this.window = [];
    this.seenSignatures.clear();
    this.redundantCounts.clear();
    this.pollTargets.clear();
    this.sleepStreak = 0;
  }

  /**
   * Observes newly completed steps from the current `callModel` round and
   * returns the first stall pattern triggered, if any. Each completed step is
   * evaluated as a whole so parallel tool results are order-independent.
   */
  observeSteps(
    steps: readonly { toolResults?: readonly ObservedToolResult[] }[],
    fromIndex: number,
  ): StallDetection | null {
    for (let i = fromIndex; i < steps.length; i++) {
      const results = steps[i]?.toolResults;
      if (!results?.length) continue;
      const hit = this.observeStep(results);
      if (hit) return hit;
    }
    return null;
  }

  observeCall(call: ObservedToolResult): StallDetection | null {
    return this.observeStep([call]);
  }

  observeStep(results: readonly ObservedToolResult[]): StallDetection | null {
    interface ClassifiedCall {
      toolName: string;
      isPoll: boolean;
      isSleep: boolean;
      isDomainWrite: boolean;
      isProgressEligible: boolean;
      inputDigest: string;
      outputDigest: string;
      signature: string;
    }

    const classified: ClassifiedCall[] = [];
    for (const call of results) {
      if (isErrorResultOutput(call.output)) continue;
      const isPoll = POLL_STATUS_TOOLS.has(call.toolName);
      const isSleep = isSleepOnlyToolCall({
        toolName: call.toolName,
        input: call.input,
      });
      const isRead = isReadOnlyToolName(call.toolName);
      // Domain writes (excluding generic `bash`, which may be read-only
      // commands like `ls`/`echo`) represent confirmed state mutations.
      const isDomainWrite =
        !isRead &&
        !isSleep &&
        call.toolName !== "bash" &&
        !NON_PROGRESS_TOOLS.has(call.toolName);
      // Any brand-new non-poll, non-sleep, non-bookkeeping call (a new domain
      // write or a new read returning previously unseen data) counts as
      // surrounding progress.
      const isProgressEligible =
        !isPoll && !isSleep && !NON_PROGRESS_TOOLS.has(call.toolName);
      const inputDigest = canonicalDigest(call.input, false);
      const outputDigest = canonicalDigest(call.output, isPoll);
      const signature = `${call.toolName}|${inputDigest}|${outputDigest}`;
      classified.push({
        toolName: call.toolName,
        isPoll,
        isSleep,
        isDomainWrite,
        isProgressEligible,
        inputDigest,
        outputDigest,
        signature,
      });
    }
    if (classified.length === 0) return null;

    // Partition the completed step so parallel result ordering never changes
    // whether a brand-new write or unread file clears earlier redundant reads.
    const freshProgress: ClassifiedCall[] = [];
    const remainder: ClassifiedCall[] = [];
    const seenFreshInStep = new Set<string>();
    for (const call of classified) {
      if (
        call.isProgressEligible &&
        !this.seenSignatures.has(call.signature) &&
        !seenFreshInStep.has(call.signature)
      ) {
        seenFreshInStep.add(call.signature);
        freshProgress.push(call);
      } else {
        remainder.push(call);
      }
    }

    const pushWindow = (entry: WindowEntry) => {
      this.window.push(entry);
      if (this.window.length > STALL_WINDOW_SIZE) {
        this.window.shift();
      }
    };

    for (const call of freshProgress) {
      this.seenSignatures.add(call.signature);
      this.redundantCounts.clear();
      this.pollTargets.clear();
      this.sleepStreak = 0;
      if (call.isDomainWrite) {
        // Brand-new domain writes drop prior read/poll entries from the window
        // while keeping prior writes so alternating writeA<->writeB still fires.
        this.window = this.window.filter((entry) => entry.isDomainWrite);
      }
      pushWindow({
        toolName: call.toolName,
        signature: call.signature,
        isDomainWrite: call.isDomainWrite,
      });
    }

    let pollHit: StallDetection | null = null;
    let repeatHit: StallDetection | null = null;

    for (const call of remainder) {
      if (this.seenSignatures.has(call.signature)) {
        const redundant = (this.redundantCounts.get(call.signature) ?? 0) + 1;
        this.redundantCounts.set(call.signature, redundant);
        if (!repeatHit && redundant >= STALL_REPEAT_THRESHOLD - 1) {
          repeatHit = {
            pattern: "repeat_same",
            tools: [call.toolName],
            count: redundant + 1,
          };
        }
      } else {
        this.seenSignatures.add(call.signature);
      }

      pushWindow({
        toolName: call.toolName,
        signature: call.signature,
        isDomainWrite: call.isDomainWrite,
      });

      // Pattern 3: unchanged status polls or repeated bash sleep waits.
      if (call.isSleep) {
        this.sleepStreak += 1;
        if (!pollHit && this.sleepStreak >= STALL_POLL_NO_PROGRESS_THRESHOLD) {
          pollHit = {
            pattern: "poll_no_progress",
            tools: ["bash"],
            count: this.sleepStreak,
          };
        }
      } else if (call.isPoll) {
        const targetKey = `${call.toolName}|${call.inputDigest}`;
        const previous = this.pollTargets.get(targetKey);
        if (previous && previous.outputDigest === call.outputDigest) {
          const streak = previous.streak + 1;
          this.pollTargets.set(targetKey, {
            outputDigest: call.outputDigest,
            streak,
          });
          if (!pollHit && streak >= STALL_POLL_NO_PROGRESS_THRESHOLD) {
            pollHit = {
              pattern: "poll_no_progress",
              tools: [call.toolName],
              count: streak,
            };
          }
        } else {
          // Status or payload changed (e.g., new Coworker comment or completion): progress!
          this.pollTargets.set(targetKey, {
            outputDigest: call.outputDigest,
            streak: 1,
          });
          this.sleepStreak = 0;
        }
      }
    }

    if (pollHit) return pollHit;
    if (repeatHit) return repeatHit;

    // Pattern 2: last 6 consecutive calls strictly alternate A-B-A-B-A-B (A != B),
    // only when this completed step produced no brand-new progress.
    if (
      freshProgress.length === 0 &&
      this.window.length >= STALL_ALTERNATING_LENGTH
    ) {
      const tail = this.window.slice(-STALL_ALTERNATING_LENGTH);
      const a = tail[0];
      const b = tail[1];
      if (
        a &&
        b &&
        a.signature !== b.signature &&
        tail.every(
          (entry, idx) =>
            entry.signature === (idx % 2 === 0 ? a.signature : b.signature),
        )
      ) {
        const uniqueTools =
          a.toolName === b.toolName ? [a.toolName] : [a.toolName, b.toolName];
        return {
          pattern: "alternating_ab",
          tools: uniqueTools,
          count: STALL_ALTERNATING_LENGTH,
        };
      }
    }

    return null;
  }
}

function describePattern(detection: StallDetection): string {
  const names = detection.tools.join(" and ");
  switch (detection.pattern) {
    case "poll_no_progress":
      return `You polled ${names} ${detection.count} times with no status change and no new completed writes.`;
    case "repeat_same":
      return `You repeated the same ${names} call ${detection.count} times with the exact same result and no new completed writes.`;
    case "alternating_ab":
      return `You alternated between ${names} (${detection.count} calls in a row) with identical results and no new completed writes.`;
  }
}

export function stallNudgePrompt(
  detection: StallDetection,
  options: {
    background: boolean;
    hasWaitFor: boolean;
    hasUpdatePlan: boolean;
  },
): string {
  const waitMove = options.hasWaitFor
    ? "Wait durably with `wait_for` (or leave an existing `followUp` wake in place and end the turn) instead of polling or sleeping."
    : "If you are waiting on delegated or external work with a follow-up wake already registered, stop polling and end the turn so the wake can deliver the result.";
  const blockMove = options.hasUpdatePlan
    ? "Or mark the step blocked with `update_plan` and report plainly what is finished and what is blocked."
    : "Or stop and report plainly what is finished and what is blocked.";
  const doneHint = options.background
    ? " If you end the run as blocked, start your report with DONE: and keep any registered watch or follow-up in place."
    : "";
  return `${describePattern(detection)} Stop repeating that loop and choose one of these moves now:\n1. ${waitMove}\n2. Change approach instead of making the same call again.\n3. ${blockMove}${doneHint}`;
}

export function stallBlockedPrompt(
  detection: StallDetection,
  background: boolean,
): string {
  const summary = describePattern(detection);
  if (background) {
    return `${summary} You repeated a no-progress loop after being warned; you cannot call tools any more. Write your final blocked report now: start it with DONE:, say what you finished, name what is blocked and why, and note that any registered watch or follow-up remains in place.`;
  }
  return `${summary} You repeated a no-progress loop after being warned; you cannot call tools any more. Answer now from what you have: say what you finished, what is blocked and why, and any watch or follow-up that remains in place.`;
}
