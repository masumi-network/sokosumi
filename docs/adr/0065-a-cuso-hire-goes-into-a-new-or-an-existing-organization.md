# A Cuso hire goes into a new or an existing organization

- Status: Accepted
- Date: 2026-11-10

Every hire used to create a new organization (ADR 0060), and CMO showed one Cuso per person: the preferred organization's, else the newest. Since Cuso became a shared Project bot ([ADR-0061](0061-cuso-is-a-shared-project-bot.md)), a business's people already reach him through their organization, and an agency or a team should not need a new organization for each website. Hiring now asks where Cuso goes: a new organization named after the website (the default, as before), or any organization the person belongs to. Every hire creates a new Project; an existing Project never gets a Cuso. An organization may hold several Cusos, one per Project, so the **Business** is the Project's, not the organization's. The person picks among their Cusos in the **Cuso picker**. This supersedes [ADR 0060](superseded/every-cuso-hire-gets-its-own-organization.md).

## Decisions

- **Any member may hire into their organization, for now.** It matches shared Soko Bots. The organization's credits pay for the research right away, and Cuso's rhythms are on from the hire.
- **The hirer's own funding gates the hire.** Core checks the turn funding that the hirer's first research turn will use, Seat included. It refuses before creating anything, so an unseated member of a paid organization never gets a Cuso whose research cannot run.
- **No personal workspace.** Shared Soko Bots, CMO's payer and the Cuso lookup are organization-only, and ADR 0060's no-mixing reason still holds.
- **Core lists, CMO picks.** Core answers every live Cuso the person can use. CMO opens the Project the address names, else the one last opened on this device (a cookie, like the skipped steps of [ADR 0062](0062-cmo-keeps-no-data-of-its-own.md)), else the only one, else the Cuso picker, else the hire form. The picker is always reachable from the account menu and ends with "Hire a new Cuso". A Project the person can't use falls through to the picker. Sokosumi's preferred organization no longer steers CMO, so a workspace switch in Sokosumi changes nothing there.
- **Hiring never hands back an existing Cuso.** The form is reached on purpose, from the picker, from Start over, or with no Cuso at all.
- **Starter credits come with every hire.** Each hire grants its organization 10,000 credits, wherever it lands. They are meant to become credits for that one Cuso's Project later.
- **Leftover reuse stays with new organizations.** A retry into an empty same-name organization, and "Use another website" renaming a solo organization that holds an archived Cuso, run only when the person chose a new organization. An existing organization is never renamed and always gets a plain new Project.
- **Start over opens the hire form**, with a new organization selected, even when other Cusos remain.

## Considered Options

- **One Cuso per organization.** The picker could list organizations, but an agency would need one organization per client, and the rule would need a check that only removes options.
- **Only owners and admins hire into an existing organization**, matching who approves and starts the month. Deferred: it is one role check to add if members' hires spend more than the organization expects.
- **Remember the choice as the preferred organization.** This ties CMO to Sokosumi's workspace switch both ways, and it still can't tell two Cusos in one organization apart.
- **Starter credits once per person**, as before. Safer, but a second business's Cuso would start with no credits to research.

## Consequences

- Credits from the grant go to the organization pool, never expire, and pay for any Sokosumi work. Any member can hire, start over and hire again to mint another 10,000 each time, and the organization limit doesn't stop it, because an existing organization is reused. This is accepted for now with a `shortcut:` in code. Credits scoped to the Cuso's Project narrow it but don't close it, since every new Project gets a fresh grant (compare [ADR 0063](0063-seat-reductions-apply-at-renewal.md)).
- Start over stays an owner and admin action, so a member who hired into a shared organization can't start over their own Cuso.
- A hire into an existing organization skips the organization helper: no free plan, no organization limit and no preferred change, since the organization already has its plan.
- The person-keyed `GET /v1/cmo` goes away with the other person-keyed routes. Project-scoped Start over answers nothing, and CMO routes again.
- A new device costs one pick for a person with several Cusos.
