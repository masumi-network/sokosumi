# Coworker chat cold-start benchmark

Repeatable benchmark for Elena (coworker chat) cold-start latency. Runs short and realistic scenarios against the OpenRouter Responses API and emits JSON for trend comparison.

## Quick start

```bash
export OPENROUTER_CHAT_API_KEY="sk-or-v1-..."
pnpm --filter core bench:coworker-chat
```

JSON is printed to stdout. Progress and threshold PASS/WARN lines go to stderr.

```bash
pnpm --filter core bench:coworker-chat -- --scenario short --iterations 2
pnpm --filter core bench:coworker-chat -- --out /tmp/bench-report.json
pnpm --filter core bench:coworker-chat -- --strict   # non-zero exit on threshold WARN
```

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | `all` | `short`, `realistic`, or `all` |
| `--iterations` | `5` | Samples per scenario (serial) |
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
| `BENCH_REQUEST_TIMEOUT_MS` | No | `30000` | Per-request abort timeout |
| `BENCH_ITERATIONS` | No | `5` | Default iterations (`--iterations` wins) |
| `BENCH_FIRST_TOKEN_P50_THRESHOLD_MS` | No | `3000` | Advisory first-token p50 threshold (ms) |
| `BENCH_AGENT_ERROR_RATE_THRESHOLD` | No | `0.1` | Advisory agent-error-rate threshold (0–1) |

## What it measures

Each iteration is a **stateless** cold request: POST to the Responses API with `stream: true`, no `/conversations`, no `previous_response_id`, no DB.

Built-in scenarios:

- **short** — single terse message (`"Hi"`) for pure first-token latency
- **realistic** — paragraph-length task prompt resembling a real Elena request

Iterations run **serially** per scenario. `results[0]` is the truest cold-start sample.

### Agent errors

A sample counts as an agent error when any of:

- Non-2xx HTTP response
- Request timeout/abort
- No first token received
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
| `git.commit` / `git.ref` | Git context when available |
| `config` | Endpoint, model, iterations, timeout |
| `thresholds` | Advisory limits used for PASS/WARN |
| `scenarios[]` | Per-scenario metrics and per-iteration `results` |
| `summary` | Aggregated totals and `thresholdStatus` |

Per-scenario metrics: `firstTokenMs` (p50/p95/min/max), `totalMs` (p50/p95), `outputTokens.p50`, `agentErrorRate`.

Per-sample `results[]`: `iteration`, `ok`, `firstTokenMs`, `totalMs`, `outputTokens`, `responseId`, `error`.

## Thresholds (advisory)

Default run **always exits 0**. Threshold comparison logs PASS or WARN to stderr.

| Metric | Default threshold | Env override |
|--------|-------------------|--------------|
| First-token p50 (ms) | 3000 | `BENCH_FIRST_TOKEN_P50_THRESHOLD_MS` |
| Agent error rate | 0.1 (10%) | `BENCH_AGENT_ERROR_RATE_THRESHOLD` |

Use `--strict` for opt-in non-zero exit when any threshold is breached (for future CI gating).

## Time semantics

- **Timestamps** in the report use ISO 8601 UTC (`generatedAt`, etc.) so trend comparisons work across machines and CI.
- **Latency values** are elapsed milliseconds from a monotonic clock (`performance.now()`), not wall-clock subtraction.
