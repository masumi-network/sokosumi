---
status: proposed
---

# CMO keeps no data of its own

CMO is a Sokosumi wrapper, yet `cmo_hire` held what Cuso learns and plans for a business (Brand Brain, strategy, calendar, reports, production) in JSON only CMO could read, so Sokosumi and the Project's other bots never saw it. Every piece becomes a Project concept or is read from data Sokosumi already has, and `cmo_hire` goes away before #5543 merges: CMO keeps only screens.

## Decisions

- **Brand Brain is the Project's.** Every bot in the Project reads it, any member edits it, any member confirms it (who and when). Its look is the Project's logo and DESIGN.md.
- **Marketing strategy is the Project's, one version per write.** Owners and admins approve one version; Cuso executes only that one; reverting approves an older one.
- **The calendar is the Project's Social posts.** Each entry is a Social post from approval on, a draft until produced. The strategy keeps only the plan.
- **Reports are messages.** Cuso's reports are result cards in his shared room; the newest is the Project's latest update.
- **Progress is read, not stored.** Production readiness comes from the Social posts and Cuso's background runs; hiring progress from the Brand Brain, the strategy, Social connections and the subscription. Only skipping the accounts step is stored, as a user preference.
- **Smaller pieces move to their owners.** The site's platform is a Project field, brand research is Project files, and the mock plan is a Subscription row without Stripe.
- **Cuso is found, not linked.** He is the Project's shared bot on CMO's version; Hiring Cuso refuses a second one in the same Project.

## Considered Options

- **Merge #5543 with a temporary `cmo_hire` and move data later.** Faster, but ships a CMO-only table whose JSON shapes every later migration has to convert.
- **Write the Brand Brain into Project memory.** Loses the structure CMO's screens edit and fights the memory size cap.

## Consequences

- #5543 waits for one stacked PR per concept into its branch; Sokosumi's screens for the Brand Brain and Marketing strategy come after it merges, while bots and CMO use `/v1` from the start.
- Any Project may have a Brand Brain and a Marketing strategy; only the tools that write them stay CMO-only for now.
- One Cuso per Project rests on the hire check, not a database index; two racing hire submits stay a known `shortcut:`.
