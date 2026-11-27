/**
 * Exa Agent runs: a question with a JSON schema, answered by Exa's agent from
 * pages it read, with a cost per run. Fixed efforts are a flat price.
 */
import { getEnv } from "@/config/env";
import { ExaUnavailableError } from "@/lib/soko-bot/exa";

const EXA_AGENT_RUNS_URL = "https://api.exa.ai/agent/runs";
const POLL_MS = 4_000;
const TIMEOUT_MS = 240_000;

export const EXA_AGENT_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ExaAgentEffort = (typeof EXA_AGENT_EFFORTS)[number];

/** Exa's flat price per run for a fixed effort, in US dollars (exa.ai/pricing). */
export const EXA_AGENT_EFFORT_USD: Record<ExaAgentEffort, number> = {
  minimal: 0.012,
  low: 0.025,
  medium: 0.1,
  high: 0.5,
};

export interface ExaAgentRunInput {
  query: string;
  systemPrompt?: string;
  effort: ExaAgentEffort;
  outputSchema: Record<string, unknown>;
  /** Rows to enrich, one object each. */
  input?: { data: Record<string, unknown>[] };
  userIdentifier?: string;
}

export interface ExaAgentCitation {
  field: string;
  urls: string[];
  confidence: string | null;
}

export interface ExaAgentRunResult {
  runId: string;
  structured: unknown;
  text: string | null;
  costUsd: number;
  citations: ExaAgentCitation[];
}

interface AgentRun {
  id?: string;
  status?: string;
  stopReason?: string | null;
  error?: { message?: string } | null;
  output?: {
    text?: string | null;
    structured?: unknown;
    grounding?: {
      field?: string;
      citations?: { url?: string }[];
      confidence?: string | null;
    }[];
  } | null;
  costDollars?: { total?: unknown } | null;
}

const FINISHED = new Set(["completed", "failed", "cancelled"]);

/** Exa accepts only `[A-Za-z0-9_-]`, at most 64 characters. */
export function exaUserIdentifier(
  value: string | undefined,
): string | undefined {
  return value?.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || undefined;
}

async function errorDetail(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string } | string;
  } | null;
  const error = body?.error;
  if (typeof error === "string") return error;
  return [error?.code, error?.message].filter(Boolean).join(": ");
}

function toResult(run: AgentRun): ExaAgentRunResult {
  if (run.status !== "completed")
    throw new ExaUnavailableError(
      `Exa agent run ${run.status ?? "unknown"}: ${run.error?.message ?? run.stopReason ?? "no reason"}`,
    );
  const total = run.costDollars?.total;
  return {
    runId: run.id ?? "",
    structured: run.output?.structured ?? null,
    text: run.output?.text ?? null,
    costUsd: typeof total === "number" ? total : 0,
    citations: (run.output?.grounding ?? []).map((item) => ({
      field: item.field ?? "",
      urls: (item.citations ?? []).flatMap((citation) =>
        citation.url ? [citation.url] : [],
      ),
      confidence: item.confidence ?? null,
    })),
  };
}

/**
 * Starts a run and waits for it. The run is paid for once it starts, so a
 * timeout is reported, not retried.
 */
export async function runExaAgent(
  input: ExaAgentRunInput,
  options: {
    fetchImpl?: typeof fetch;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<ExaAgentRunResult> {
  const key = getEnv().EXA_API_KEY;
  if (!key) throw new ExaUnavailableError("Exa is not configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { "x-api-key": key, "content-type": "application/json" };
  const started = await fetchImpl(EXA_AGENT_RUNS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: input.query,
      systemPrompt: input.systemPrompt,
      effort: input.effort,
      outputSchema: input.outputSchema,
      input: input.input,
      userIdentifier: exaUserIdentifier(input.userIdentifier),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!started.ok) {
    const detail = await errorDetail(started);
    throw new ExaUnavailableError(
      `Exa agent run could not start (${started.status}${detail ? `, ${detail}` : ""})`,
    );
  }
  let run = (await started.json()) as AgentRun;
  const runId = run.id;
  if (!runId) throw new ExaUnavailableError("Exa agent run has no id");
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS);
  while (!FINISHED.has(run.status ?? "")) {
    if (Date.now() > deadline)
      throw new ExaUnavailableError(`Exa agent run ${runId} took too long`);
    await new Promise((resolve) =>
      setTimeout(resolve, options.pollMs ?? POLL_MS),
    );
    const polled = await fetchImpl(
      `${EXA_AGENT_RUNS_URL}/${encodeURIComponent(runId)}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );
    if (!polled.ok)
      throw new ExaUnavailableError(
        `Exa agent run ${runId} could not be read (${polled.status})`,
      );
    run = (await polled.json()) as AgentRun;
  }
  return toResult(run);
}
