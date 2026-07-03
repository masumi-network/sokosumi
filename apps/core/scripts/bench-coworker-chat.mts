/**
 * Benchmark coworker chat cold-start latency via a coworker's Responses API.
 *
 * Stateless requests only — no conversations or Core HTTP server.
 *
 *   pnpm --filter core bench:coworker-chat
 *   pnpm --filter core bench:coworker-chat -- --scenario short --iterations 10
 *   pnpm --filter core bench:coworker-chat -- --out docs/coworker/benchmarks/latest.json
 *
 * Resolves the coworker endpoint from BENCH_COWORKER_RESPONSES_URL,
 * BENCH_COWORKER_BASE_URL, COWORKERS_API_BASE_URL, or DATABASE_URL lookup.
 * See docs/coworker/benchmarks/README.md.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { createPrismaClient } from "@sokosumi/database/client";

const DEFAULT_COWORKER_SLUG = "elena";
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_ITERATIONS = 5;
const DEFAULT_FIRST_TOKEN_P50_THRESHOLD_MS = 1200;
const DEFAULT_AGENT_ERROR_RATE_THRESHOLD = 0.05;
const MAX_ACCUMULATED_TEXT_LENGTH = 50_000;

const COWORKER_AGENT_ERROR_MARKERS = [
  "AGENT_ERROR",
  "Something went wrong while processing your task",
] as const;

const RESPONSES_API_EVENTS = {
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  COMPLETED: "response.completed",
} as const;

const SSE_DONE_MARKER = "[DONE]";
const SSE_DATA_PREFIX = "data: ";

const SCENARIOS = {
  short: {
    turns: ["Hi"],
  },
  realistic: {
    turns: [
      "I'm preparing a go-to-market brief for our AI coworker product. Please outline a structured approach: key research areas about the target market, 3–5 competitor differentiators to investigate, suggested data sources, and 2–3 quick wins we could validate in the next two weeks. Keep it actionable but concise.",
      "Add the first three concrete validation steps you would run tomorrow, and call out the main risk for each one.",
    ],
  },
} as const;

type ScenarioName = keyof typeof SCENARIOS;

type BaseUrlSource =
  | "responses_url"
  | "base_url"
  | "coworkers_api_base_url"
  | "database";

interface SampleResult {
  iteration: number;
  ok: boolean;
  firstTokenMs: number | null;
  totalDurationMs: number | null;
  outputTokens: number | null;
  responseId: string | null;
  agentError: boolean;
  error: string | null;
}

interface BenchmarkMetrics {
  firstToken: {
    p50: number | null;
    p95: number | null;
  };
  totalDuration: {
    p50: number | null;
    p95: number | null;
  };
  outputTokens: {
    mean: number | null;
  };
  agentError: {
    rate: number;
  };
}

interface BenchmarkReport {
  benchmark: "bench-coworker-chat";
  version: 2;
  generatedAt: string;
  scenario: ScenarioName;
  coworkerSlug: string;
  iterations: number;
  metrics: BenchmarkMetrics;
  samples: SampleResult[];
  git: { commit: string | null; ref: string | null };
  config: {
    endpoint: string;
    coworkerSlug: string;
    baseUrlSource: BaseUrlSource;
    requestTimeoutMs: number;
  };
  thresholds: {
    firstTokenP50Ms: number;
    agentErrorRate: number;
  };
  thresholdStatus: {
    firstTokenP50: "pass" | "warn";
    agentErrorRate: "pass" | "warn";
  };
}

interface CliOptions {
  scenario: ScenarioName;
  iterations: number;
  coworkerSlug: string;
  userId: string | undefined;
  organizationId: string | undefined;
  baseUrl: string | undefined;
  out: string | undefined;
  strict: boolean;
}

interface CoworkerBenchConfig {
  endpoint: string;
  coworkerSlug: string;
  sokosumiUserId: string;
  sokosumiOrganizationId: string | null;
  baseUrlSource: BaseUrlSource;
}

function parseArgs(argv: string[]): CliOptions {
  let scenario: ScenarioName = "short";
  let iterations = parseIntEnv("BENCH_ITERATIONS", DEFAULT_ITERATIONS);
  let coworkerSlug =
    process.env.BENCH_COWORKER_SLUG?.trim() || DEFAULT_COWORKER_SLUG;
  let userId: string | undefined;
  let organizationId: string | undefined;
  let baseUrl: string | undefined;
  let out: string | undefined;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario" && argv[i + 1]) {
      scenario = argv[++i] as ScenarioName;
    } else if (arg === "--iterations" && argv[i + 1]) {
      iterations = Number.parseInt(argv[++i] ?? "", 10);
    } else if (arg === "--coworker-slug" && argv[i + 1]) {
      coworkerSlug = argv[++i] ?? coworkerSlug;
    } else if (arg === "--user-id" && argv[i + 1]) {
      userId = argv[++i];
    } else if (arg === "--organization-id" && argv[i + 1]) {
      organizationId = argv[++i];
    } else if (arg === "--base-url" && argv[i + 1]) {
      baseUrl = argv[++i];
    } else if (arg === "--out" && argv[i + 1]) {
      out = argv[++i];
    } else if (arg === "--strict") {
      strict = true;
    }
  }

  return {
    scenario,
    iterations,
    coworkerSlug,
    userId,
    organizationId,
    baseUrl,
    out,
    strict,
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getGitInfo(): { commit: string | null; ref: string | null } {
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const ref = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    return { commit, ref };
  } catch {
    return { commit: null, ref: null };
  }
}

function toResponsesEndpoint(baseOrResponsesUrl: string): string {
  const trimmed = baseOrResponsesUrl.replace(/\/$/, "");
  return trimmed.endsWith("/responses") ? trimmed : `${trimmed}/responses`;
}

async function withDatabase<T>(
  fn: (prisma: ReturnType<typeof createPrismaClient>) => Promise<T>,
): Promise<T | null> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function resolveCoworkerBaseUrlFromDatabase(
  slug: string,
): Promise<string | null> {
  return (
    (await withDatabase(async (prisma) => {
      const coworker = await prisma.coworker.findFirst({
        where: {
          slug,
          archivedAt: null,
          isWhitelisted: true,
          capabilities: { has: "chat" },
          baseURL: { not: null },
        },
        select: { baseURL: true },
      });
      return coworker?.baseURL?.trim() ?? null;
    })) ?? null
  );
}

async function resolveDefaultUserIdFromDatabase(): Promise<string | null> {
  return (
    (await withDatabase(async (prisma) => {
      const user = await prisma.user.findFirst({
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return user?.id ?? null;
    })) ?? null
  );
}

async function resolveBenchConfig(options: {
  coworkerSlug: string;
  userIdFlag?: string;
  organizationIdFlag?: string;
  baseUrlFlag?: string;
}): Promise<CoworkerBenchConfig> {
  const responsesUrl = process.env.BENCH_COWORKER_RESPONSES_URL?.trim();
  const configuredBaseUrl =
    options.baseUrlFlag?.trim() ||
    process.env.BENCH_COWORKER_BASE_URL?.trim() ||
    process.env.COWORKERS_API_BASE_URL?.trim();

  let endpoint: string;
  let baseUrlSource: BaseUrlSource;

  if (responsesUrl) {
    endpoint = toResponsesEndpoint(responsesUrl);
    baseUrlSource = "responses_url";
  } else if (configuredBaseUrl) {
    endpoint = toResponsesEndpoint(configuredBaseUrl);
    baseUrlSource =
      configuredBaseUrl === process.env.COWORKERS_API_BASE_URL?.trim()
        ? "coworkers_api_base_url"
        : "base_url";
  } else {
    const baseUrlFromDatabase = await resolveCoworkerBaseUrlFromDatabase(
      options.coworkerSlug,
    );
    if (!baseUrlFromDatabase) {
      console.error(
        "Error: could not resolve a coworker Responses endpoint. Set one of:",
      );
      console.error("  BENCH_COWORKER_RESPONSES_URL");
      console.error("  BENCH_COWORKER_BASE_URL");
      console.error("  COWORKERS_API_BASE_URL");
      console.error("  DATABASE_URL (to look up coworker.baseURL by slug)");
      process.exit(1);
    }
    endpoint = toResponsesEndpoint(baseUrlFromDatabase);
    baseUrlSource = "database";
  }

  const sokosumiUserId =
    options.userIdFlag?.trim() ||
    process.env.BENCH_SOKOSUMI_USER_ID?.trim() ||
    (await resolveDefaultUserIdFromDatabase());

  if (!sokosumiUserId) {
    console.error(
      "Error: BENCH_SOKOSUMI_USER_ID is required when DATABASE_URL is unavailable.",
    );
    process.exit(1);
  }

  const sokosumiOrganizationId =
    options.organizationIdFlag?.trim() ||
    process.env.BENCH_SOKOSUMI_ORGANIZATION_ID?.trim() ||
    null;

  return {
    endpoint,
    coworkerSlug: options.coworkerSlug,
    sokosumiUserId,
    sokosumiOrganizationId,
    baseUrlSource,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function nullablePercentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  return percentile(values, p);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractOutputTokens(chunk: {
  response?: { usage?: { output_tokens?: number } };
  usage?: { output_tokens?: number };
}): number | null {
  const fromResponse = chunk.response?.usage?.output_tokens;
  if (typeof fromResponse === "number") return fromResponse;
  const fromRoot = chunk.usage?.output_tokens;
  if (typeof fromRoot === "number") return fromRoot;
  return null;
}

function sanitizeErrorMessage(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.replaceAll(secret, "[REDACTED]");
    }
  }
  return sanitized;
}

function hasAgentErrorMarker(text: string): boolean {
  return COWORKER_AGENT_ERROR_MARKERS.some((marker) => text.includes(marker));
}

function buildCoworkerHeaders(
  config: CoworkerBenchConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": config.sokosumiUserId,
    "X-Coworker-Slug": config.coworkerSlug,
  };

  if (config.sokosumiOrganizationId) {
    headers["X-Sokosumi-Organization-Id"] = config.sokosumiOrganizationId;
  }

  const serviceKey =
    process.env.BENCH_COWORKER_SERVICE_KEY?.trim() ||
    process.env.COWORKERS_API_SERVICE_KEY?.trim();
  if (serviceKey) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }

  return headers;
}

function buildCoworkerRequestBody(turns: readonly string[]) {
  return {
    input: turns.map((text) => ({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    })),
    stream: true,
  };
}

async function runSample(options: {
  config: CoworkerBenchConfig;
  turns: readonly string[];
  requestTimeoutMs: number;
  iteration: number;
  redactSecrets: string[];
}): Promise<SampleResult> {
  const startMs = performance.now();
  let firstTokenMs: number | null = null;
  let totalDurationMs: number | null = null;
  let outputTokens: number | null = null;
  let responseId: string | null = null;
  let accumulatedText = "";
  let error: string | null = null;

  const requestBody = buildCoworkerRequestBody(options.turns);

  try {
    const response = await fetch(options.config.endpoint, {
      method: "POST",
      headers: buildCoworkerHeaders(options.config),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(options.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      const sanitizedError = sanitizeErrorMessage(
        errorText,
        options.redactSecrets,
      );
      return {
        iteration: options.iteration,
        ok: false,
        firstTokenMs: null,
        totalDurationMs: null,
        outputTokens: null,
        responseId: null,
        agentError: true,
        error: `HTTP ${response.status}: ${sanitizedError.slice(0, 200)}`,
      };
    }

    if (!response.body) {
      return {
        iteration: options.iteration,
        ok: false,
        firstTokenMs: null,
        totalDurationMs: null,
        outputTokens: null,
        responseId: null,
        agentError: true,
        error: "No response body",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim() || line.startsWith(":")) continue;
        if (!line.startsWith(SSE_DATA_PREFIX)) continue;

        const data = line.slice(SSE_DATA_PREFIX.length).trimEnd();

        if (data === SSE_DONE_MARKER) {
          totalDurationMs ??= performance.now() - startMs;
          streamDone = true;
          break;
        }

        try {
          const chunk = JSON.parse(data);

          if (
            typeof chunk === "object" &&
            chunk !== null &&
            typeof chunk.type === "string"
          ) {
            if (
              chunk.type === RESPONSES_API_EVENTS.OUTPUT_TEXT_DELTA &&
              typeof chunk.delta === "string"
            ) {
              if (firstTokenMs === null) {
                firstTokenMs = performance.now() - startMs;
              }
              if (accumulatedText.length < MAX_ACCUMULATED_TEXT_LENGTH) {
                accumulatedText += chunk.delta;
              }
            }

            if (chunk.type === RESPONSES_API_EVENTS.COMPLETED) {
              totalDurationMs = performance.now() - startMs;
              if (
                typeof chunk.response === "object" &&
                chunk.response !== null &&
                typeof chunk.response.id === "string"
              ) {
                responseId = chunk.response.id;
              }
              outputTokens = extractOutputTokens(chunk);
              streamDone = true;
              break;
            }
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    if (totalDurationMs === null && firstTokenMs !== null) {
      totalDurationMs = performance.now() - startMs;
    }

    if (firstTokenMs === null) {
      error = "No first token received";
    } else if (hasAgentErrorMarker(accumulatedText)) {
      error = "Agent error marker in output";
    }

    const agentError = error !== null;
    const ok = !agentError;

    return {
      iteration: options.iteration,
      ok,
      firstTokenMs,
      totalDurationMs,
      outputTokens,
      responseId,
      agentError,
      error: ok ? null : error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitizedMessage = sanitizeErrorMessage(
      message,
      options.redactSecrets,
    );
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");

    return {
      iteration: options.iteration,
      ok: false,
      firstTokenMs: null,
      totalDurationMs: null,
      outputTokens: null,
      responseId: null,
      agentError: true,
      error: isTimeout ? "Request timeout" : sanitizedMessage,
    };
  }
}

async function runScenario(
  name: ScenarioName,
  options: {
    config: CoworkerBenchConfig;
    iterations: number;
    requestTimeoutMs: number;
    redactSecrets: string[];
  },
): Promise<SampleResult[]> {
  const scenario = SCENARIOS[name];
  const results: SampleResult[] = [];

  for (let i = 1; i <= options.iterations; i++) {
    const result = await runSample({
      config: options.config,
      turns: scenario.turns,
      requestTimeoutMs: options.requestTimeoutMs,
      iteration: i,
      redactSecrets: options.redactSecrets,
    });
    results.push(result);
  }

  return results;
}

function isScenarioName(scenario: string): scenario is ScenarioName {
  return scenario in SCENARIOS;
}

function createMetrics(samples: SampleResult[]): BenchmarkMetrics {
  const okFirstTokens = samples
    .filter((sample) => sample.ok && sample.firstTokenMs !== null)
    .map((sample) => sample.firstTokenMs as number);
  const okTotals = samples
    .filter((sample) => sample.ok && sample.totalDurationMs !== null)
    .map((sample) => sample.totalDurationMs as number);
  const okOutputTokens = samples
    .filter((sample) => sample.ok && sample.outputTokens !== null)
    .map((sample) => sample.outputTokens as number);
  const agentErrors = samples.filter((sample) => sample.agentError).length;

  return {
    firstToken: {
      p50: nullablePercentile(okFirstTokens, 50),
      p95: nullablePercentile(okFirstTokens, 95),
    },
    totalDuration: {
      p50: nullablePercentile(okTotals, 50),
      p95: nullablePercentile(okTotals, 95),
    },
    outputTokens: {
      mean: mean(okOutputTokens),
    },
    agentError: {
      rate: samples.length > 0 ? agentErrors / samples.length : 0,
    },
  };
}

function evaluateThresholds(report: BenchmarkReport, strict: boolean): number {
  const { metrics, thresholds } = report;
  let hasWarn = false;

  const firstTokenP50 = metrics.firstToken.p50;
  if (firstTokenP50 === null || firstTokenP50 > thresholds.firstTokenP50Ms) {
    report.thresholdStatus.firstTokenP50 = "warn";
    hasWarn = true;
    console.error(
      firstTokenP50 === null
        ? `WARN: no successful first-token samples to compare against ${thresholds.firstTokenP50Ms}ms threshold`
        : `WARN: first-token p50 ${firstTokenP50}ms exceeds threshold ${thresholds.firstTokenP50Ms}ms`,
    );
  } else {
    console.error(
      `PASS: first-token p50 ${firstTokenP50}ms within threshold ${thresholds.firstTokenP50Ms}ms`,
    );
  }

  if (metrics.agentError.rate >= thresholds.agentErrorRate) {
    report.thresholdStatus.agentErrorRate = "warn";
    hasWarn = true;
    console.error(
      `WARN: agent error rate ${(metrics.agentError.rate * 100).toFixed(1)}% breaches threshold < ${(thresholds.agentErrorRate * 100).toFixed(1)}%`,
    );
  } else {
    console.error(
      `PASS: agent error rate ${(metrics.agentError.rate * 100).toFixed(1)}% within threshold < ${(thresholds.agentErrorRate * 100).toFixed(1)}%`,
    );
  }

  return strict && hasWarn ? 1 : 0;
}

async function main() {
  const {
    scenario,
    iterations,
    coworkerSlug,
    userId,
    organizationId,
    baseUrl,
    out,
    strict,
  } = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(iterations) || iterations < 1) {
    console.error("Error: --iterations must be a positive integer.");
    process.exit(1);
  }

  if (!isScenarioName(scenario)) {
    console.error(
      `Error: unknown scenario "${scenario}". Use short or realistic.`,
    );
    process.exit(1);
  }

  const benchConfig = await resolveBenchConfig({
    coworkerSlug,
    userIdFlag: userId,
    organizationIdFlag: organizationId,
    baseUrlFlag: baseUrl,
  });

  const requestTimeoutMs = parseIntEnv(
    "BENCH_REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const firstTokenP50ThresholdMs = parseIntEnv(
    "BENCH_FIRST_TOKEN_P50_THRESHOLD_MS",
    DEFAULT_FIRST_TOKEN_P50_THRESHOLD_MS,
  );
  const agentErrorRateThreshold = parseFloatEnv(
    "BENCH_AGENT_ERROR_RATE_THRESHOLD",
    DEFAULT_AGENT_ERROR_RATE_THRESHOLD,
  );

  const redactSecrets = [
    process.env.BENCH_COWORKER_SERVICE_KEY?.trim() ?? "",
    process.env.COWORKERS_API_SERVICE_KEY?.trim() ?? "",
  ];

  console.error(
    `Running scenario "${scenario}" against ${benchConfig.endpoint} (${iterations} iterations)...`,
  );
  console.error(
    `Coworker slug: ${benchConfig.coworkerSlug} · base URL source: ${benchConfig.baseUrlSource}`,
  );

  const samples = await runScenario(scenario, {
    config: benchConfig,
    iterations,
    requestTimeoutMs,
    redactSecrets,
  });
  const metrics = createMetrics(samples);

  const report: BenchmarkReport = {
    benchmark: "bench-coworker-chat",
    version: 2,
    generatedAt: new Date().toISOString(),
    scenario,
    coworkerSlug: benchConfig.coworkerSlug,
    iterations,
    metrics,
    samples,
    git: getGitInfo(),
    config: {
      endpoint: benchConfig.endpoint,
      coworkerSlug: benchConfig.coworkerSlug,
      baseUrlSource: benchConfig.baseUrlSource,
      requestTimeoutMs,
    },
    thresholds: {
      firstTokenP50Ms: firstTokenP50ThresholdMs,
      agentErrorRate: agentErrorRateThreshold,
    },
    thresholdStatus: {
      firstTokenP50: "pass",
      agentErrorRate: "pass",
    },
  };

  const exitCode = evaluateThresholds(report, strict);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json);

  if (out) {
    writeFileSync(out, json);
    console.error(`Wrote report to ${out}`);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
