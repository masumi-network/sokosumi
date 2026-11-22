# Effects live only in named hooks

- Status: Accepted
- Date: 2026-11-20

Product code in Web and CMO never calls `useEffect`, `useLayoutEffect` or `useMountEffect` directly. An effect lives only in a hook under the app's `src/hooks/effects/` that is named for one job, has a test, and takes no general effect callback. A single-site, owner-named hook (for example `useSeoAgentVerdictFocus`, `useTasksRestoredViewUrl`) is the standard way to host an effect; extract a shared hook (`useEventListener`, `useInterval`) only when several sites already do the same job identically. A GritQL Biome plugin warns on direct calls across product files (aliases and indirections stay Biome errors); locally, `pnpm effects:check` (run in Husky pre-commit) checks the live repo against each app's per-file `effect-baseline.json`, and CI's `Biome` job runs the full `scripts/ci/__tests__/no-direct-effects.test.mjs` suite with `EFFECT_BASELINE_BASE_REF` set to the base SHA so counts may only shrink.

**Why:** agents copy what they find. Effects were the most copied workaround (496 call sites, about 15% not needed at all per [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)), and a late effect caused the #7747 race. A deterministic check holds where a line in a prose rule does not.

## Decisions

- **Single-source enforcement through `effect-baseline.json`.** `no-direct-effects.grit` runs across all product files at `warn` severity with no per-file list in `biome.json`; `no-effect-aliases.grit` stays `error` everywhere. Locally, `pnpm effects:check` (in Husky pre-commit) checks the live repo against the sorted, one-entry-per-line `effect-baseline.json`; in CI, the `Biome` job runs the full `scripts/ci/__tests__/no-direct-effects.test.mjs` suite against the base SHA (`EFFECT_BASELINE_BASE_REF`) to also reject any baseline growth.
- **Single-site owner-named hooks are the standard pattern.** Rather than keeping `effects/` small by generalizing one-off effects into reusable APIs (which creates multi-owner contracts and subtle timing or callback-binding regressions), each real effect lives in a single-site hook named for its owner and job with its own behaviour test. Shared primitives (`useEventListener`, `useInterval`, `useTimeout`, observer hooks) are extracted only when multiple call sites already share identical semantics.
- **The baseline is per file and never rises.** A new file starts at zero. A real need adds a named hook to `effects/`, never a baseline entry.
- **No `biome-ignore` for the effect rule.** The CI test that checks the baseline fails on one.
- **`useMountEffect` counts as an effect.** A general callback hook, in or out of `effects/`, would bypass the rule.
- **Exempt:** tests, test fixtures and `src/components/ui/**` (vendored shadcn).
- **Touching an exempt file does not force its migration.** Migration tickets shrink the baseline, one job category per PR.

## Considered options

- **A single total count.** Rejected: an added effect hides behind a removed one elsewhere.
- **A one-time migration before the rule.** Rejected: 496 call sites block the rule for weeks while new ones keep landing.
- **Allow effects in any `use-*.ts` file.** Rejected: renaming a file would pass the check.
