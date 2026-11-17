# Browser E2E smoke

Required before changing `apps/web/e2e/` or running it. Paths are relative to the repository root.

The harness in `apps/web/e2e/` drives a real browser against a deployed Web app with Playwright (already locked in `apps/web`) and `node:test`. It uses `node:test`, not Vitest, so `Test Web` never runs it without a target URL. It adds no dependencies and runs in no CI job yet; a preview-CI job is a follow-up.

## Run

```bash
E2E_BASE_URL=https://<preview-host> pnpm --filter web e2e
```

- `E2E_BASE_URL` is required. There is no default. `e2e/base-url.ts` accepts only `localhost`, `127.0.0.1`, `preprod.sokosumi.com`, `*.preview.sokosumi.com` and `*.vercel.app`, and refuses everything else, production included.
- Deploy a preview first (`/deploy preprod` on the PR, see [delivery](./delivery.md)). Do not start local Sokosumi services for this.
- Specs run one at a time (`--test-concurrency=1`): `tasks.test.ts` creates mail.tm inboxes, and mail.tm rate-limits bursts.
- Chromium must be installed once: `pnpm --filter web exec playwright install chromium`.

## Specs

| Spec                             | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/base-url.test.ts`           | URL guard: required, allowed hosts only. Needs no browser.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `e2e/smoke.test.ts`              | `/signin` and `/signup` at phone 375x812, tablet 768x1024 and desktop 1440x900: page loads, email field shows inside the main landmark, no horizontal overflow, no console or page errors.                                                                                                                                                                                                                                                                                                        |
| `e2e/history.test.ts`            | Credit history at the same three sizes for a signed-in disposable user with at least one ledger row (signup credits count): a search with no match offers **Clear filters**, and the Source filter names every source. Skipped unless `E2E_STORAGE_STATE` points to that user's Playwright storage state, created per run and never committed.                                                                                                                                                    |
| `e2e/onboarding.test.ts`         | Persona A happy path at the same three sizes, one new throwaway user each: root, Register, emailed code from a [mail.tm](https://mail.tm) inbox (`e2e/mailbox.ts`), Personal workspace, Soko Bot name and picture, Skip connect, chat. Each auth and setup step sits in one main landmark; the email chip is named by its address; no page errors. Needs network access to `api.mail.tm`.                                                                                                         |
| `e2e/personal-assistant.test.ts` | A new user per size (disposable mail.tm inbox): sign up, name the Soko Bot with only spaces and see "Enter a name.", then create it, skip connect and open its Advanced view, where Memory says "No memory yet." and lists no "None". No page errors.                                                                                                                                                                                                                                             |
| `e2e/tasks.test.ts`              | A new user per size (disposable mail.tm inbox, the email code from the API): sign up, create a Task for themselves, rename it to a long title (the title field must not cut it off), see its card on the board with no empty "No tags yet" line, archive, find it in Archived (the name wraps), restore. Checks the activity Subscribe button is at least 24px tall and the page has no overflow or page errors. Calls Sokosumi's own free naming and tagging.                                    |
| `e2e/seo.test.ts`                | A new user per size (disposable mail.tm inbox): sign up, open SEO through the app's own navigation (the You page on a phone, the sidebar elsewhere), start an audit from the bare domain `example.com`, add `example.com/about` the same way, and track a keyword with Germany and German picked by name, and see its market and one "No target page" line. On a phone the header's back link goes to You. Checks no overflow or page errors. Saves pages and a keyword only; runs no paid check. |

Screenshots go to `apps/web/e2e/results/` (gitignored).

## Rules for specs

- Public pages only, or new disposable test users you create for the run (`e2e/mailbox.ts` makes one throwaway inbox per user; it stores nothing). Never a real account, real customer data or production.
- Never commit or log credentials.
- Test at public seams: the URL, what the user sees, and the console. Do not reach into app internals.
