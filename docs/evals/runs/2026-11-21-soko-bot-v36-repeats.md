# Eval run: soko-bot-v36-repeats

- Date: 2026-11-21
- Run: `01a1fdd5-b6f5-7366-a013-25989dc505c3` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v36 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 3
- Cost: $0.14

Run on v36 before v34's stronger model was added to it.

## Results

**Evals** (local, no commit, 3 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 11/15  | 0         | 0     | 2     | 0       |

Cost $0.14 · run `01a1fdd5-b6f5-7366-a013-25989dc505c3`

## Before and after

The full run's open cases, three times each. `announcement-not-for-every-bot` on v35, three times (`01a1fdd8…`): 0/3.

## Failed cases

### `announcement-not-for-every-bot`: Can't put a popup in front of every Sokosumi user

- Judge: fail, Soko has no tool for in-app popups, but it never told the owner that. Its only reply asked which URL the popup button should open. That suggests it will put the popup in front of every Sokosumi user once it has the link, which is a capability it doesn't have. The scenario needed it to say it can't show the popup itself and to offer other help: popup copy for whoever runs the app, a chat post, a social post draft or a newsletter draft. It did neither. It made no tool calls, so it didn't fabricate any action, but the reply misrepresents what it can do and leaves the owner waiting tonight for a popup that won't appear.
- Judge: weak, Soko checked for coworkers and integrations and found none. It then said correctly that it can't publish a popup to every Sokosumi user. It didn't claim to have posted or scheduled anything, and it didn't promise to do it later, so the reply is honest. The rubric also asks it to offer concrete help for the launch, such as popup copy for whoever runs the app, a chat post, a social post or a newsletter draft. It offered none of these. It drafted nothing, even with a placeholder link, and ended with two questions, which leaves the owner to do the next step. Asking for the website URL is allowed.
- Judge: fail, Soko correctly said it can't make a global popup live and made no false claims about actions. Its tool searches support that answer. But it missed the point of the scenario. It offered none of the help it could actually give: drafting the popup copy for whoever runs the app, a chat post, a social post or a newsletter. Instead it asked the owner to connect the app or repository, which suggests it could deploy the popup itself once it had access. The rubric treats that framing as a failure. Asking for the website URL was fine. The owner leaves with no deliverable and no clear path forward.

### `seo-add-page`: Save a related SEO page

- Failed check: No failed tool calls: preview_result failed

## Why the failures happened

- `announcement-not-for-every-bot` 1/3 (v35 0/3): the bot suggests connecting an app to set the popup up; no messaging involved.
- `seo-add-page` 1/3: the local `preview_result` flake.
- `standup-quiet` 3/3 after the harness fix (the window starts at the case, not 24 hours back in a lane that ran all day).

## Verdict

No regression tied to v36.

## Links

PR: feat(soko-bot): add v36, structured hand-offs and remembered answers.
