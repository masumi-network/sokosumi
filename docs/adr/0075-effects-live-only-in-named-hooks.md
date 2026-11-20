# Effects live only in named hooks

- Status: Accepted
- Date: 2026-11-20

Product code in Web and CMO never calls `useEffect`, `useLayoutEffect` or `useMountEffect` directly. An effect lives only in a hook under the app's `src/hooks/effects/` that is named for one job (`useEventListener`, `useInterval`), has a test, and takes no general effect callback. A GritQL Biome plugin enforces it as an error; existing code is exempt through a per-file `effect-baseline.json` whose counts may only shrink.

**Why:** agents copy what they find. Effects were the most copied workaround (496 call sites, about 15% not needed at all per [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)), and a late effect caused the #7747 race. A deterministic check holds where a line in a prose rule does not.

## Decisions

- **The baseline is per file and never rises.** A new file starts at zero. A real need adds a named hook to `effects/`, never a baseline entry.
- **No `biome-ignore` for the effect rule.** The CI test that checks the baseline fails on one.
- **`useMountEffect` counts as an effect.** A general callback hook, in or out of `effects/`, would bypass the rule.
- **Exempt:** tests, test fixtures and `src/components/ui/**` (vendored shadcn).
- **Touching an exempt file does not force its migration.** Migration tickets shrink the baseline, one job category per PR.

## Considered options

- **A single total count.** Rejected: an added effect hides behind a removed one elsewhere.
- **A one-time migration before the rule.** Rejected: 496 call sites block the rule for weeks while new ones keep landing.
- **Allow effects in any `use-*.ts` file.** Rejected: renaming a file would pass the check.
