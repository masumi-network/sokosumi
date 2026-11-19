# Competitor monitoring is a Project feature

- Status: Accepted
- Date: 2026-11-18

Competitor monitoring shipped as part of CMO: only a Cuso's Project could track competitors, the routes lived under `/v1/cmo`, the weekly check ran only for paid Cusos, and Sokosumi had no page for it. Patrick expected it to work like SEO and talking videos, where Sokosumi owns the feature and CMO uses it. It is now a feature of any Project, and CMO is one user of it.

## Decisions

- **Any Project tracks competitors.** The list (up to five), the signals, the checks and the week's feed are the Project's, in the tables they already had. The routes are `/v1/projects/{id}/competitors`: read the page, add, change and remove a competitor, turn the weekly check on or off (`/checks`), and run the check that is due (`/check`).
- **The weekly check is off until a member turns it on.** `project.competitorChecksSince` is the switch. A check costs 3 credits per competitor a week (what its Exa search and model calls cost at most, plus the 50% markup on paid data, rounded up: `apps/core/src/lib/competitors/price.ts`) and is charged to the Project's own payer: its organization's credit pool, or the person in a personal workspace. It is paid in full or does not run. The debit is linked from the check (`competitor_check.transactionId`), which is also what makes a check that is run again pay once.
- **A CMO Project's check stays automatic.** It runs while its Cuso is paid for and has an approved strategy, whatever the switch says, and is charged as his Soko Bot usage under the same key as before. One sync (`/sync/competitors`) runs both kinds.
- **CMO keeps what is CMO's.** Filling the list from the Brand Brain, the market map's players, Cuso's watch run after a check, posting big moves to his room and "Add to strategy" live in `cmo-competitors.service.ts`, which calls the Project services. `/v1/cmo/projects/{projectId}/competitors` stays as a thin layer: it finds the person's Cuso and requires CMO's app (ADR 0066), then calls the same services.
- **Every Soko Bot gets the competitor tools on a Project with the check on.** `check_competitors` and `save_competitor_feed` are offered while the weekly check is on for the bot's Project, or for any open Project of its workspace when the bot works across Projects, which then names the Project. Core checks a bot's save exactly as it checks Cuso's. Only Cuso's big moves are posted to his room; another bot tells the owner itself. A Soko Bot can read a CMO Project's signals and never writes its feed.
- **A member can ask for suggestions.** `POST /v1/projects/{id}/competitors/suggestions` finds up to eight competitors from the Project's website (an Exa company search sorted by the check's model, which may add well-known ones whose site Core then reads) and stores nothing: the member adds the ones they pick. A run costs about 1.4 cents and is free. A picked suggestion is added with `suggested`, which leaves its empty fields open for the weekly check to fill from its homepage. A Cuso's list is still filled from his Brand Brain.
- **A CMO Project is read-only on the Project routes** like every other write there (ADR 0066): Sokosumi shows its competitors and changes nothing.

## Considered Options

- **Move CMO onto the Project routes.** ADR 0066 refuses every write to a CMO Project outside `/v1/cmo/**`, so CMO would need an exception to its own lock.
- **Charge a Project's check as Soko Bot usage.** A Project that turns the check on may have no Soko Bot, and the charge would hang on a bot that did not ask for it.
- **Let a short balance pay part of a check**, as a bot's usage does. A member who turned the check on should get the whole check or none, and see why.
