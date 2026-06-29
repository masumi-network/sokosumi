#!/usr/bin/env node
/**
 * Benchmark Elena (or any coworker) via the Coworkers Conversations + Responses API.
 *
 * Reads `COWORKERS_API_BASE_URL` and `COWORKERS_API_SERVICE_KEY` from apps/core/.env.
 *
 * Usage:
 *   pnpm --filter core bench:coworker-chat
 *   pnpm --filter core bench:coworker-chat -- --message "Hello Elena"
 *   pnpm --filter core bench:coworker-chat -- --warmup 1 --turns 3 --json
 *   pnpm --filter core bench:coworker-chat -- --json-out .cursor/elena-bench.json
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
config({ path: join(scriptDir, "../.env") });

const DEFAULT_USER_ID = "tlWZpOti3028HUbtsY49CkuaSbadJwGm";
const DEFAULT_COWORKER_SLUG = "elena";
const DEFAULT_MESSAGE =
  "Hi Elena — reply in one short sentence so I can measure latency.";
const AGENT_ERROR_SNIPPET = "Something went wrong while processing your task";

const BENCH_SCENARIOS = {
  short: DEFAULT_MESSAGE,
  realistic:
    "Create a research task about my company, including competitors, positioning, and quick wins. Outline the steps you would take and what you need from me.",
} as const;

type BenchScenario = keyof typeof BENCH_SCENARIOS;

export interface EnvConfig {
  baseUrl: string;
  serviceKey: string;
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
}

interface ConversationResult {
  id: string;
  durationMs: number;
}

export interface ResponseTimings {
  ttfbMs: number;
  firstTokenMs: number | null;
  completedMs: number;
  responseId: string | null;
  textLength: number;
  eventCounts: Record<string, number>;
}

export interface TurnRecord {
  index: number;
  kind: "warmup" | "measured";
  message: string;
  ttfbMs: number;
  firstTokenMs: number | null;
  completedMs: number;
  responseId: string | null;
  outputChars: number;
  preview: string;
  agentError: boolean;
}

export interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
}

export interface BenchmarkReport {
  meta: {
    ranAt: string;
    scenario: BenchScenario | "custom";
    baseUrl: string;
    userId: string;
    organizationId: string | null;
    coworkerSlug: string;
    message: string;
    warmupTurns: number;
    measuredTurns: number;
  };
  conversation: {
    id: string;
    createMs: number | null;
  };
  warmup: TurnRecord[];
  turns: TurnRecord[];
  summary: {
    conversationCreateMs: number | null;
    measuredCount: number;
    ttfbMs: LatencyStats | null;
    firstTokenMs: LatencyStats | null;
    completedMs: LatencyStats | null;
    outputChars: LatencyStats | null;
    agentErrorCount: number;
  };
  steadyState: {
    successCount: number;
    ttfbMs: LatencyStats | null;
    firstTokenMs: LatencyStats | null;
    completedMs: LatencyStats | null;
    outputChars: LatencyStats | null;
  };
}

interface ParsedArgs {
  message: string;
  scenario: BenchScenario | "custom";
  interactive: boolean;
  turns: number;
  warmup: number;
  reuseConversation: boolean;
  conversationId: string | null;
  json: boolean;
  jsonOut: string | null;
  quietStream: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let message = DEFAULT_MESSAGE;
  let scenario: BenchScenario | "custom" = "short";
  let messageOverridden = false;
  let interactive = false;
  let turns = 1;
  let warmup = 0;
  let reuseConversation = false;
  let conversationId: string | null = null;
  let json = false;
  let jsonOut: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--message" && argv[i + 1]) {
      message = argv[++i]!;
      messageOverridden = true;
      scenario = "custom";
      continue;
    }
    if (arg === "--scenario" && argv[i + 1]) {
      const value = argv[++i]!;
      if (value in BENCH_SCENARIOS) {
        scenario = value as BenchScenario;
        if (!messageOverridden) {
          message = BENCH_SCENARIOS[scenario];
        }
      } else {
        throw new Error(
          `Unknown scenario "${value}". Use: ${Object.keys(BENCH_SCENARIOS).join(", ")}`,
        );
      }
      continue;
    }
    if (arg === "--interactive") {
      interactive = true;
      continue;
    }
    if (arg === "--turns" && argv[i + 1]) {
      turns = Math.max(1, Number.parseInt(argv[++i]!, 10) || 1);
      continue;
    }
    if (arg === "--warmup" && argv[i + 1]) {
      warmup = Math.max(0, Number.parseInt(argv[++i]!, 10) || 0);
      continue;
    }
    if (arg === "--conversation" && argv[i + 1]) {
      conversationId = argv[++i]!;
      reuseConversation = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--json-out" && argv[i + 1]) {
      jsonOut = argv[++i]!;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return {
    message,
    scenario,
    interactive,
    turns,
    warmup,
    reuseConversation,
    conversationId,
    json,
    jsonOut,
    quietStream: json && !interactive,
  };
}

function printHelp() {
  console.log(`bench-coworker-chat — direct Conversations + Responses API timing

Options:
  --scenario <name>      Preset prompt: short | realistic (default: short)
  --message <text>       Custom user message (overrides scenario)
  --interactive          REPL; type messages until "exit"
  --turns <n>            Measured turns after warmup (default: 1)
  --warmup <n>           Warmup turns excluded from summary stats (default: 0)
  --conversation <id>    Skip create; reuse an existing provider conversation id
  --json                 Print machine-readable report to stdout at end
  --json-out <path>      Write report JSON to file (repo-relative ok)

Scenarios:
  short       One-sentence latency probe
  realistic   Elena-style research task request (from product copy)

Env (from apps/core/.env or shell):
  COWORKERS_API_BASE_URL
  COWORKERS_API_SERVICE_KEY
  SOKOSUMI_USER_ID       (default: ${DEFAULT_USER_ID})
  SOKOSUMI_ORGANIZATION_ID (optional)
  COWORKER_SLUG          (default: ${DEFAULT_COWORKER_SLUG})
`);
}

function requireEnv(): EnvConfig {
  const baseUrl = process.env.COWORKERS_API_BASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.COWORKERS_API_SERVICE_KEY?.trim();
  const userId = process.env.SOKOSUMI_USER_ID?.trim() || DEFAULT_USER_ID;
  const organizationId = process.env.SOKOSUMI_ORGANIZATION_ID?.trim() || null;
  const coworkerSlug =
    process.env.COWORKER_SLUG?.trim() || DEFAULT_COWORKER_SLUG;

  if (!baseUrl) {
    throw new Error("Missing COWORKERS_API_BASE_URL in apps/core/.env");
  }
  if (!serviceKey) {
    throw new Error("Missing COWORKERS_API_SERVICE_KEY in apps/core/.env");
  }

  return { baseUrl, serviceKey, userId, organizationId, coworkerSlug };
}

function buildHeaders(env: EnvConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.serviceKey}`,
    "X-Sokosumi-User-Id": env.userId,
    "X-Coworker-Slug": env.coworkerSlug,
  };
  if (env.organizationId) {
    headers["X-Sokosumi-Organization-Id"] = env.organizationId;
  }
  return headers;
}

function maskSensitive(
  value: string,
  visiblePrefix = 4,
  visibleSuffix = 2,
): string {
  if (!value) return "[redacted]";
  if (value.length <= visiblePrefix + visibleSuffix) return "[redacted]";
  return `${value.slice(0, visiblePrefix)}…${value.slice(-visibleSuffix)}`;
}

function extractConversationId(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).id;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id.trim();
  }
  return null;
}

async function createConversation(
  env: EnvConfig,
  sokosumiConversationId: string,
): Promise<ConversationResult> {
  const started = performance.now();
  const response = await fetch(`${env.baseUrl}/conversations`, {
    method: "POST",
    headers: buildHeaders(env),
    body: JSON.stringify({
      metadata: {
        sokosumi_user_id: env.userId,
        coworker_slug: env.coworkerSlug,
        sokosumi_conversation_id: sokosumiConversationId,
        ...(env.organizationId
          ? { sokosumi_organization_id: env.organizationId }
          : {}),
      },
    }),
  });

  const durationMs = performance.now() - started;
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `POST /conversations failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `POST /conversations returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  const id = extractConversationId(body);
  if (!id) {
    throw new Error(
      `POST /conversations returned no id: ${text.slice(0, 500)}`,
    );
  }

  return { id, durationMs };
}

function formatMs(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function looksLikeAgentError(text: string): boolean {
  return text.includes(AGENT_ERROR_SNIPPET);
}

async function streamResponse(
  env: EnvConfig,
  conversationId: string,
  message: string,
  options: { quiet: boolean },
): Promise<{ timings: ResponseTimings; preview: string }> {
  const started = performance.now();
  let ttfbMs = 0;
  let firstTokenMs: number | null = null;
  let completedMs = 0;
  let responseId: string | null = null;
  let textBuffer = "";
  const eventCounts: Record<string, number> = {};

  const response = await fetch(`${env.baseUrl}/responses`, {
    method: "POST",
    headers: buildHeaders(env),
    body: JSON.stringify({
      conversation: conversationId,
      stream: true,
      input: [{ role: "user", content: message }],
    }),
  });

  ttfbMs = performance.now() - started;

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `POST /responses failed (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const body = response.body;
  if (!body) {
    throw new Error("POST /responses returned no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  if (!options.quiet) {
    process.stdout.write("\n--- assistant (streaming) ---\n");
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = typeof event.type === "string" ? event.type : "unknown";
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;

      if (type === "response.created") {
        const nested = event.response;
        if (nested && typeof nested === "object") {
          const id = (nested as Record<string, unknown>).id;
          if (typeof id === "string") {
            responseId = id;
          }
        }
      }

      if (type === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta.length > 0) {
          if (firstTokenMs === null) {
            firstTokenMs = performance.now() - started;
          }
          textBuffer += delta;
          if (!options.quiet) {
            process.stdout.write(delta);
          }
        }
      }

      if (type === "response.completed") {
        completedMs = performance.now() - started;
        const nested = event.response;
        if (nested && typeof nested === "object") {
          const id = (nested as Record<string, unknown>).id;
          if (typeof id === "string") {
            responseId = id;
          }
        }
      }
    }
  }

  if (completedMs === 0) {
    completedMs = performance.now() - started;
  }

  if (!options.quiet) {
    process.stdout.write("\n--- end stream ---\n\n");
  }

  return {
    timings: {
      ttfbMs,
      firstTokenMs,
      completedMs,
      responseId,
      textLength: textBuffer.length,
      eventCounts,
    },
    preview: textBuffer.slice(0, 160),
  };
}

function computeStats(values: number[]): LatencyStats {
  const sorted = values.toSorted((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mid = Math.floor(sorted.length / 2);
  const p50 =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p50,
  };
}

function statsFromTurns(
  turns: TurnRecord[],
  pick: (turn: TurnRecord) => number | null,
): LatencyStats | null {
  const values = turns
    .map(pick)
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  return computeStats(values);
}

export function buildBenchmarkReport(input: {
  env: EnvConfig;
  scenario: BenchScenario | "custom";
  message: string;
  warmupTurns: number;
  measuredTurns: number;
  conversationId: string;
  conversationCreateMs: number | null;
  warmup: TurnRecord[];
  turns: TurnRecord[];
}): BenchmarkReport {
  const successTurns = input.turns.filter((turn) => !turn.agentError);

  return {
    meta: {
      ranAt: new Date().toISOString(),
      scenario: input.scenario,
      baseUrl: input.env.baseUrl,
      userId: input.env.userId,
      organizationId: input.env.organizationId,
      coworkerSlug: input.env.coworkerSlug,
      message: input.message,
      warmupTurns: input.warmupTurns,
      measuredTurns: input.measuredTurns,
    },
    conversation: {
      id: input.conversationId,
      createMs: input.conversationCreateMs,
    },
    warmup: input.warmup,
    turns: input.turns,
    summary: {
      conversationCreateMs: input.conversationCreateMs,
      measuredCount: input.turns.length,
      ttfbMs: statsFromTurns(input.turns, (turn) => turn.ttfbMs),
      firstTokenMs: statsFromTurns(input.turns, (turn) => turn.firstTokenMs),
      completedMs: statsFromTurns(input.turns, (turn) => turn.completedMs),
      outputChars: statsFromTurns(input.turns, (turn) => turn.outputChars),
      agentErrorCount: input.turns.filter((turn) => turn.agentError).length,
    },
    steadyState: {
      successCount: successTurns.length,
      ttfbMs: statsFromTurns(successTurns, (turn) => turn.ttfbMs),
      firstTokenMs: statsFromTurns(successTurns, (turn) => turn.firstTokenMs),
      completedMs: statsFromTurns(successTurns, (turn) => turn.completedMs),
      outputChars: statsFromTurns(successTurns, (turn) => turn.outputChars),
    },
  };
}

function printTimings(
  label: string,
  conversation: ConversationResult | null,
  response: ResponseTimings,
) {
  console.log(`=== ${label} ===`);
  if (conversation) {
    console.log(
      `conversation create: ${formatMs(conversation.durationMs)} → ${conversation.id}`,
    );
  }
  console.log(`response TTFB:        ${formatMs(response.ttfbMs)}`);
  console.log(
    `first token:          ${response.firstTokenMs === null ? "n/a" : formatMs(response.firstTokenMs)}`,
  );
  console.log(`stream completed:     ${formatMs(response.completedMs)}`);
  console.log(`response id:          ${response.responseId ?? "n/a"}`);
  console.log(`output chars:         ${response.textLength}`);
  const topEvents = Object.entries(response.eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, count]) => `${type}×${count}`)
    .join(", ");
  console.log(`sse events:           ${topEvents || "none"}`);
  console.log("");
}

function printSummary(report: BenchmarkReport) {
  const { summary, steadyState } = report;
  console.log("=== summary (measured turns only) ===");
  if (summary.conversationCreateMs !== null) {
    console.log(
      `conversation create: ${formatMs(summary.conversationCreateMs)}`,
    );
  }
  if (summary.ttfbMs) {
    console.log(
      `TTFB p50/mean:       ${formatMs(summary.ttfbMs.p50)} / ${formatMs(summary.ttfbMs.mean)}`,
    );
  }
  if (summary.firstTokenMs) {
    console.log(
      `first token p50/mean: ${formatMs(summary.firstTokenMs.p50)} / ${formatMs(summary.firstTokenMs.mean)}`,
    );
  }
  if (summary.completedMs) {
    console.log(
      `completed p50/mean:  ${formatMs(summary.completedMs.p50)} / ${formatMs(summary.completedMs.mean)}`,
    );
  }
  if (summary.outputChars) {
    console.log(
      `output chars p50/mean: ${Math.round(summary.outputChars.p50)} / ${Math.round(summary.outputChars.mean)}`,
    );
  }
  console.log(
    `agent errors:        ${summary.agentErrorCount}/${summary.measuredCount}`,
  );
  if (steadyState.successCount > 0 && steadyState.firstTokenMs) {
    console.log("");
    console.log(
      `=== steady-state (${steadyState.successCount} success turns) ===`,
    );
    console.log(
      `first token p50/mean: ${formatMs(steadyState.firstTokenMs.p50)} / ${formatMs(steadyState.firstTokenMs.mean)}`,
    );
    if (steadyState.completedMs) {
      console.log(
        `completed p50/mean:  ${formatMs(steadyState.completedMs.p50)} / ${formatMs(steadyState.completedMs.mean)}`,
      );
    }
  }
  console.log("");
}

function resolveJsonOutPath(pathArg: string): string {
  return pathArg.startsWith("/") ? pathArg : join(repoRoot, pathArg);
}

function writeReportJson(report: BenchmarkReport, pathArg: string) {
  const absolutePath = resolveJsonOutPath(pathArg);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolutePath;
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runTurn(
  env: EnvConfig,
  conversationId: string,
  message: string,
  label: string,
  conversationTiming: ConversationResult | null,
  options: { quiet: boolean; kind: "warmup" | "measured"; index: number },
): Promise<TurnRecord> {
  if (!options.quiet) {
    console.log(`user: ${message}`);
  } else {
    console.log(`[${label}] sending…`);
  }

  const { timings, preview } = await streamResponse(
    env,
    conversationId,
    message,
    { quiet: options.quiet },
  );

  if (!options.quiet) {
    printTimings(label, conversationTiming, timings);
  } else {
    console.log(
      `[${label}] TTFB ${formatMs(timings.ttfbMs)} · first token ${timings.firstTokenMs === null ? "n/a" : formatMs(timings.firstTokenMs)} · done ${formatMs(timings.completedMs)}`,
    );
  }

  return {
    index: options.index,
    kind: options.kind,
    message,
    ttfbMs: timings.ttfbMs,
    firstTokenMs: timings.firstTokenMs,
    completedMs: timings.completedMs,
    responseId: timings.responseId,
    outputChars: timings.textLength,
    preview,
    agentError: looksLikeAgentError(preview),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = requireEnv();

  if (!args.json) {
    console.log("Coworker chat benchmark");
    console.log(`  base URL:  ${env.baseUrl}`);
    console.log("  user:      [configured]");
    console.log(`  coworker:  ${env.coworkerSlug}`);
    console.log(`  scenario:  ${args.scenario}`);
    if (env.organizationId) {
      console.log(`  org:       ${env.organizationId}`);
    }
    if (args.warmup > 0) {
      console.log(`  warmup:    ${args.warmup} turn(s)`);
    }
    console.log("");
  }

  let conversationId = args.conversationId;
  let conversationTiming: ConversationResult | null = null;

  if (!conversationId) {
    const sokosumiConversationId = `bench-${randomUUID()}`;
    if (!args.json) {
      console.log(`Creating conversation (${sokosumiConversationId})…`);
    }
    conversationTiming = await createConversation(env, sokosumiConversationId);
    conversationId = conversationTiming.id;
    if (!args.json) {
      console.log(
        `Created provider conversation in ${formatMs(conversationTiming.durationMs)} → ${conversationId}\n`,
      );
    }
  } else if (!args.json) {
    console.log(`Reusing conversation ${conversationId}\n`);
  }

  const warmupRecords: TurnRecord[] = [];
  const measuredRecords: TurnRecord[] = [];

  if (args.interactive) {
    if (!args.json) {
      console.log('Interactive mode. Type a message (or "exit").\n');
    }
    let turn = 1;
    while (true) {
      const line = await promptLine("you> ");
      if (
        !line ||
        line.toLowerCase() === "exit" ||
        line.toLowerCase() === "quit"
      ) {
        break;
      }
      const record = await runTurn(
        env,
        conversationId,
        line,
        `turn ${turn}`,
        turn === 1 && !args.reuseConversation ? conversationTiming : null,
        { quiet: false, kind: "measured", index: turn },
      );
      measuredRecords.push(record);
      turn++;
    }
  } else {
    let turnIndex = 1;
    for (let i = 1; i <= args.warmup; i++) {
      const record = await runTurn(
        env,
        conversationId,
        args.message,
        `warmup ${i}/${args.warmup}`,
        i === 1 && !args.reuseConversation ? conversationTiming : null,
        {
          quiet: args.quietStream,
          kind: "warmup",
          index: turnIndex++,
        },
      );
      warmupRecords.push(record);
    }

    for (let i = 1; i <= args.turns; i++) {
      const record = await runTurn(
        env,
        conversationId,
        args.message,
        args.turns > 1 ? `turn ${i}/${args.turns}` : "single turn",
        i === 1 && args.warmup === 0 && !args.reuseConversation
          ? conversationTiming
          : null,
        {
          quiet: args.quietStream,
          kind: "measured",
          index: turnIndex++,
        },
      );
      measuredRecords.push(record);
    }
  }

  const report = buildBenchmarkReport({
    env,
    scenario: args.scenario,
    message: args.message,
    warmupTurns: args.warmup,
    measuredTurns: measuredRecords.length,
    conversationId,
    conversationCreateMs: conversationTiming?.durationMs ?? null,
    warmup: warmupRecords,
    turns: measuredRecords,
  });

  if (args.jsonOut) {
    const written = writeReportJson(report, args.jsonOut);
    if (!args.json) {
      console.log(`Wrote JSON report → ${written}`);
    }
  }

  if (args.json) {
    const sanitizedReport = {
      ...report,
      meta: {
        ...report.meta,
        userId: "[REDACTED]",
        organizationId: report.meta.organizationId ? "[REDACTED]" : null,
      },
    };
    console.log(JSON.stringify(sanitizedReport, null, 2));
  } else {
    printSummary(report);
    console.log(
      `Conversation id (reuse with --conversation): ${conversationId}`,
    );
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
