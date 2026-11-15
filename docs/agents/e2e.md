# Browser E2E smoke

Required before changing `apps/web/e2e/` or running it. Paths are relative to the repository root.

The harness in `apps/web/e2e/` drives a real browser against a deployed Web app with Playwright (already locked in `apps/web`) and `node:test`. It adds no dependencies and runs in no CI job yet; a preview-CI job is a follow-up.

## Run

```bash
E2E_BASE_URL=https://<preview-host> pnpm --filter web e2e
```

- `E2E_BASE_URL` is required. There is no default. `e2e/base-url.ts` accepts only `localhost`, `127.0.0.1`, `preprod.sokosumi.com`, `*.preview.sokosumi.com` and `*.vercel.app`, and refuses everything else, production included.
- Deploy a preview first (`/deploy preprod` on the PR, see [delivery](./delivery.md)). Do not start local Sokosumi services for this.
- Chromium must be installed once: `pnpm --filter web exec playwright install chromium`.

## Specs

| Spec                   | Checks                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/base-url.test.ts` | URL guard: required, allowed hosts only. Needs no browser.                                                                                                        |
| `e2e/smoke.test.ts`    | `/signin` and `/signup` at phone 375x812, tablet 768x1024 and desktop 1440x900: page loads, email field shows, no horizontal overflow, no console or page errors. |

Screenshots go to `apps/web/e2e/results/` (gitignored).

## Rules for specs

- Public pages only, or new disposable test users you create for the run. Never a real account, real customer data or production.
- Never commit or log credentials.
- Test at public seams: the URL, what the user sees, and the console. Do not reach into app internals.
