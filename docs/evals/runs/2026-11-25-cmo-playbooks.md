# Eval run: cmo-playbooks

- Date: 2026-11-25 (Gateway run), 2026-11-26 (plan rerun)
- Run: `01a214f9-6ba3-7518-acb3-f5de5693e49a` (manual, completed, Gateway) and `01a2155f-fe79-7706-b733-e20eb21f5b13` (manual, completed, `evals:local --plan`)
- Environment: local (own database `soko_mktskills`)
- Commit: `ee03c6a716` feat(soko-bot): add 14 marketing playbooks Cuso reads on demand (Gateway run, before the version gate), `3c425d8648` (plan rerun)
- Bots: Cuso cmo-v20 (Gateway run; every version saw the playbooks before the gate), Cuso cmo-v25 with `cmo-playbooks` added in the local checkout only (plan rerun)
- Judge: claude-code
- Repeats: 1
- Cost: $0.54 (Gateway run); the plan run reports no cost

## Results

| Case                        | Gateway run | Plan rerun | Reads skill    | Judge |
| --------------------------- | ----------- | ---------- | -------------- | ----- |
| `cmo-landing-page-copy`     | error       | passed     | landing-page   | pass  |
| `cmo-page-review-first-fix` | passed      |            | page-review    | pass  |
| `cmo-launch-plan`           | passed      |            | launch-plan    | pass  |
| `cmo-trial-welcome-emails`  | failed      | passed     | email-sequence | pass  |

## Before and after

No baseline: the four cases are new. They are skipped on any Cuso version without the `cmo-playbooks` skill, so weekly runs on today's default report them as skipped.

## Failed cases

### `cmo-landing-page-copy`: Reads the landing page skill before writing page copy

- Gateway run: "The turn did not settle in 20 minutes". The turn read landing-page and brand-voice and wrote the copy in 14 seconds; settling it then failed with a Prisma transaction timeout (P2028) while the machine was overloaded.

### `cmo-trial-welcome-emails`: Writes trial welcome emails from the email sequence skill

- Failed check: Answer avoids bracket placeholders: the answer linked each email's button as Markdown (`[Explore Cal.com Teams](https://cal.com/teams)`).
- Judge: pass.

## Why the failures happened

The landing-page error was the local machine, not Cuso: the answer was finished before the turn failed to settle. The email failure was the check: the placeholder pattern also matched Markdown links, which an email draft should have. The new cases now use a pattern that skips links and still catches `[first name]` (unit test in `scenarios.test.ts`). Both cases passed on the rerun.

## Verdict

Ship. Each case read the playbook its request needed and the judge passed every answer. The playbooks reach no live Cuso until a version lists `cmo-playbooks` (planned: cmo-v26), whose full CMO suite run is the default-deciding proof.

## Links

Source: marketingskills by Corey Haines (MIT), attribution in `packages/soko-bot/THIRD_PARTY_NOTICES.md`.
