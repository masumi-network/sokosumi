# PRs run selected tests; the merge queue runs the full suite

- Status: Accepted
- Date: 2026-11-16

PR CI took 9.3 minutes at p50 and 12.9 at p95 over 150 runs, almost all of it inside the Web and Core Vitest runs; waiting (~2s) and setup (~33s) were not the cost. To give a PR its result faster, a pull request runs only the test files its diff can reach, and a GitHub merge queue on `main` runs every suite in full before anything merges. A PR that skipped a test file is deliberate: do not "fix" it by running everything on `pull_request`, and do not drop the queue while selection is on.

## Decisions

- **Selection is per file, not per package.** Vitest `--changed` against the merge base, in Web and Core. Package-level skipping already comes from path gating and the Turbo cache. A change to anything imports cannot trace (Vitest config, setup files, `package.json`, `pnpm-lock.yaml`, `apps/web/messages/*.json`, `.github/**`) runs the full suite.
- **The queue runs every required check on `merge_group`**, Apple's included, with the full Vitest suites and the same job-level path gating `main` already trusts. Squash merges, one PR per group to start.
- **Speed never hides a failure.** No retries, no wider timeouts, no skipped or deleted tests. A check that needs a retry has a bug.
- **Budgets fail the job.** Target 5 minutes p50 and 7 minutes p95 per PR; each test job gets `timeout-minutes: 7` once it already runs under it.
- **Free changes first.** No paid runners until `isolate: false`, selection and the PostgreSQL split are measured; the organization's 20-job limit still caps parallelism.

## Considered Options

- **Auto-merge without a queue, running everything on PRs.** What we had: correct, but every PR paid for the whole suite.
- **Selection on PRs without a queue.** Faster, but a miss in selection lands untested code on `main`, which deploys production.
- **Sharding or paid runners.** Shards queued behind the 20-job limit before; paid runners wait for numbers from the free changes.

## Consequences

- Every merge waits for one full run in the queue before it deploys.
- Selection must be proven: hide a real breaking change from it on purpose and confirm CI goes red, on the PR through the fallback or in the queue.
