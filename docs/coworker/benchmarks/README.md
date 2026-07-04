# Coworker chat cold-start benchmark

Repeatable benchmark for Elena (coworker chat) cold-start latency. Runs short and realistic scenarios against a coworker's Responses API (`{baseURL}/responses`) with the same Sokosumi headers Core uses in production.

## Quick start

```bash
pnpm bench:coworker-chat
```

Loads `apps/core/.env` automatically. JSON is printed to stdout. Progress and threshold PASS/WARN lines go to stderr.

```bash
pnpm bench:coworker-chat -- --scenario short --iterations 10
pnpm bench:coworker-chat -- --scenario realistic --out /tmp/bench-report.json
pnpm bench:coworker-chat -- --coworker-slug elena --strict
```

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | `short` | `short` or `realistic` |
| `--iterations` | `5` | Samples for the selected scenario (serial) |
| `--coworker-slug` | `elena` | Coworker slug sent as `X-Coworker-Slug` |
| `--user-id` | see env | Sokosumi user id sent as `X-Sokosumi-User-Id` |
| `--organization-id` | see env | Optional org id sent as `X-Sokosumi-Organization-Id` |
| `--base-url` | see env | Coworker Responses base URL (without `/responses`) |
| `--out` | — | Optional path to write the JSON report |
| `--strict` | off | Exit non-zero when advisory thresholds are breached |

## Environment variables

Bench-only variables. They are **not** in `apps/core/.env.example` or `src/config/env.ts`.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `BENCH_COWORKER_RESPONSES_URL` | No* | — | Full Responses endpoint URL (highest priority) |
| `BENCH_COWORKER_BASE_URL` | No* | — | Coworker Responses base URL; `/responses` is appended |
| `COWORKERS_API_BASE_URL` | No* | — | Fallback base URL when the above are unset |
| `DATABASE_URL` | No* | — | Look up `coworker.baseURL` by slug when no base URL env is set |
| `BENCH_COWORKER_SLUG` | No | `elena` | Default coworker slug (`--coworker-slug` wins) |
| `BENCH_SOKOSUMI_USER_ID` | No** | — | User id header; falls back to oldest user in DB |
| `BENCH_SOKOSUMI_ORGANIZATION_ID` | No | — | Optional org id header |
| `BENCH_COWORKER_SERVICE_KEY` | No | — | Optional Bearer token if the coworker API requires it |
| `COWORKERS_API_SERVICE_KEY` | No | — | Alias for `BENCH_COWORKER_SERVICE_KEY` |
| `BENCH_REQUEST_TIMEOUT_MS` | No | `25000` | Per-request abort timeout |
| `BENCH_ITERATIONS` | No | `5` | Default iterations (`--iterations` wins) |
| `BENCH_FIRST_TOKEN_P50_THRESHOLD_MS` | No | `1200` | Advisory first-token p50 threshold (ms) |
| `BENCH_AGENT_ERROR_RATE_THRESHOLD` | No | `0.05` | Advisory agent-error-rate threshold (0–1) |

\*At least one endpoint source is required: `BENCH_COWORKER_RESPONSES_URL`, `BENCH_COWORKER_BASE_URL`, `COWORKERS_API_BASE_URL`, or `DATABASE_URL`.

\*\*Required only when `DATABASE_URL` is unavailable.

**OpenRouter is not used.** Coworker chat in Core always streams to `{coworker.baseURL}/responses` with Sokosumi headers, not OpenRouter.

## What it measures

Each iteration is a **stateless** cold request: POST to `{baseURL}/responses` with `stream: true`, no `/conversations`, no `previous_response_id`, no Core HTTP server.

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

## JSON report schema (v2)

See [sample-report.json](./sample-report.json) for a full example.

Top-level fields:

| Field | Description |
|-------|-------------|
| `benchmark` | Always `"bench-coworker-chat"` |
| `version` | Schema version (`2`) |
| `generatedAt` | ISO 8601 **UTC** timestamp |
| `scenario` | Selected scenario: `short` or `realistic` |
| `coworkerSlug` | Coworker slug used in requests |
| `iterations` | Number of requested samples |
| `metrics` | Aggregate p50/p95 latency, mean output tokens, and error rate |
| `samples[]` | Per-iteration results |
| `git.commit` / `git.ref` | Git context when available |
| `config` | Endpoint, slug, base URL source, and timeout |
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
