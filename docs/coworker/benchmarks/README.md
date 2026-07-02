# Coworker chat cold-start benchmark

Repeatable benchmark for Elena (coworker chat) cold-start latency. Runs short and realistic scenarios against the OpenRouter Responses API and emits JSON for trend comparison.

## Quick start

```bash
export OPENROUTER_CHAT_API_KEY="sk-or-v1-..."
pnpm bench:coworker-chat
```

JSON is printed to stdout. Progress and threshold PASS/WARN lines go to stderr.

```bash
pnpm bench:coworker-chat -- --scenario short --iterations 2
pnpm bench:coworker-chat -- --scenario realistic --out /tmp/bench-report.json
pnpm bench:coworker-chat -- --strict   # non-zero exit on threshold WARN
```

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | `short` | `short` or `realistic` |
| `--iterations` | `5` | Samples for the selected scenario (serial) |
| `--model` | see env | OpenRouter model identifier |
| `--out` | — | Optional path to write the JSON report |
| `--strict` | off | Exit non-zero when advisory thresholds are breached |

## Environment variables

Bench-only variables. They are **not** in `apps/core/.env.example` or `src/config/env.ts`.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENROUTER_CHAT_API_KEY` | Yes | — | Bearer token for the Responses API |
| `BENCH_COWORKER_RESPONSES_URL` | No | `https://openrouter.ai/api/v1/responses` | Responses API endpoint; override for Elena’s coworker base URL |
| `BENCH_COWORKER_MODEL` | No | `getModelIdentifier(null)` → e.g. `openai/gpt-5.4` | Model identifier |
| `BENCH_REQUEST_TIMEOUT_MS` | No | `25000` | Per-request abort timeout, matching coworker conversation startup |
| `BENCH_ITERATIONS` | No | `5` | Default iterations (`--iterations` wins) |
| `BENCH_FIRST_TOKEN_P50_THRESHOLD_MS` | No | `1200` | Advisory first-token p50 threshold (ms) |
| `BENCH_AGENT_ERROR_RATE_THRESHOLD` | No | `0.05` | Advisory agent-error-rate threshold (0–1) |

## What it measures

Each iteration is a **stateless** cold request: POST to the Responses API with `stream: true`, no `/conversations`, no `previous_response_id`, no DB.

Built-in scenarios:

- **short** — single terse message (`"Hi"`) for pure first-token latency
- **realistic** — two user turns resembling a real Elena request

Iterations run **serially** for the selected scenario. `samples[0]` is the truest cold-start sample.

### Agent errors

A sample counts as an agent error when any of:

- Non-2xx HTTP response
- Request timeout/abort
- No first token received
- Output contains `AGENT_ERROR`
- Output contains `Something went wrong while processing your task`

Errors are counted; the run continues.

## JSON report schema (v1)

See [sample-report.json](./sample-report.json) for a full example.

Top-level fields:

| Field | Description |
|-------|-------------|
| `benchmark` | Always `"bench-coworker-chat"` |
| `version` | Schema version (`1`) |
| `generatedAt` | ISO 8601 **UTC** timestamp |
| `scenario` | Selected scenario: `short` or `realistic` |
| `model` | OpenRouter model slug |
| `iterations` | Number of requested samples |
| `metrics` | Aggregate p50/p95 latency, mean output tokens, and error rate |
| `samples[]` | Per-iteration results |
| `git.commit` / `git.ref` | Git context when available |
| `config` | Endpoint and timeout |
| `thresholds` | Advisory limits used for PASS/WARN |
| `thresholdStatus` | `pass` or `warn` for each advisory threshold |

Aggregate metrics: `firstToken` (p50/p95), `totalDuration` (p50/p95), `outputTokens.mean`, `agentError.rate`.

Per-sample `samples[]`: `iteration`, `ok`, `firstTokenMs`, `totalDurationMs`, `outputTokens`, `responseId`, `agentError`, `error`.

## Thresholds (advisory)

Default run **always exits 0**. Threshold comparison logs PASS or WARN to stderr.

| Metric | Default threshold | Env override |
|--------|-------------------|--------------|
| First-token p50 (ms) | `<= 1200` | `BENCH_FIRST_TOKEN_P50_THRESHOLD_MS` |
| Agent error rate | `< 0.05` (5%) | `BENCH_AGENT_ERROR_RATE_THRESHOLD` |

Use `--strict` for opt-in non-zero exit when any threshold is breached (for future CI gating).

## Time semantics

- **Timestamps** in the report use ISO 8601 UTC (`generatedAt`, etc.) so trend comparisons work across machines and CI.
- **Latency values** are elapsed milliseconds from a monotonic clock (`performance.now()`), not wall-clock subtraction.
