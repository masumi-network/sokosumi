# The Owner is the person who answers for the work

- Status: Accepted
- Supersedes: [ADR-0056](./superseded/work-has-an-owner-only-when-private.md), and "`ownerId` is the creator" in [ADR-0020](./0020-assigned-seat-for-paid-org-work.md)
- Date: 2026-10-15

Every Task, Task Schedule and Job had one required `ownerId`, filled with whoever made it. Soko Bots shared by a Project or an Organization ([SOK-1356](https://linear.app/masumi/issue/SOK-1356/soko-bots-owned-by-an-organization-or-a-project)) act for many people and sometimes for nobody, so code had to invent an Owner, and the invented one went wrong: a schedule deleted together with its member, a stale fallback Organization owner, one person @mentioned on every team rhythm.

The Owner stays one stored column, `ownerId`, and means the person who answers for the work: who made it, or the person a Coworker or Soko Bot made it for. It is null when nobody answers for it. Private work is visible only to its Owner, as before. The **Creator** sits beside it as a record: the person, Coworker or Soko Bot that made the work (`creatorUserId`, `creatorCoworkerId`, `creatorSokoBotId`). When a Coworker or Soko Bot made the work, the Owner is the person it was made for.

## Considered Options

- **An Owner only on private work, with a computed responsible person** ([ADR-0056](./superseded/work-has-an-owner-only-when-private.md)). Every rule asked for the responsible person, never for the stored Owner, so the same three-column fallback had to run in TypeScript, Prisma filters and raw SQL, and the Core API needed a second field carrying the value `ownerId` already held.
- **A Requester column beside the Owner** for the person a Coworker or Soko Bot made the work for. It would always equal the Owner or be null: the Owner changes only after the old Owner deleted their account, which clears both. If a way to hand work to someone else is added, it can be filled from `ownerId` wherever the Creator is a Coworker or Soko Bot.
- **Keep a required Owner and attribute shared-bot work to a member.** It needs a chain of fallbacks to pick the member, and every link in it can point at the wrong person.
- **Make Task participants the readers of private work.** That turns a following list into an access list: an @mention would grant access to private work.

## Consequences

- The Owner decides charges and the Seat check, the "my work" filter (`scope=owned`), notifications, a Coworker's reach, moving work to another workspace, and Job writes.
- The Owner is set when the work is made: the person who made it, or the person a Coworker or Soko Bot made it for. A Job a Soko Bot or Coworker hires for a Task gets the Task's Owner. It changes only when a member resumes a paused Task Schedule that has no Owner; that member becomes its Owner.
- Private work always has an Owner, and SQL enforces it: `visibility = 'PRIVATE'` implies `"ownerId" IS NOT NULL`. Visibility stays fixed after creation.
- Work without an Owner comes from Soko Bots acting on their own and from public work whose Owner deleted their account. In an Organization, credits always come from the Organization pool; a charge for such work is recorded with `Transaction.userId` null and skips the Seat check. A Soko Bot's work is capped by `proactiveDailyLimit`. Any seated member may edit such work; deleting, moving or refunding it needs an Organization owner or admin, and it cannot move to a personal workspace.
- Deleting a user deletes the private work they own. Their public work stays without an Owner: `ownerId` and `creatorUserId` become null, and the Creator check relaxes to "at most one", where none means a deleted person. The public Task Schedules they owned pause, so nothing keeps spending with nobody behind it. In-flight Jobs they own still block deletion.
- `SokoBotSchedule`, `SokoBotTurn` and `SokoBotPendingDecision` rename `userId` to a nullable `requestedByUserId`: the person who asked the Soko Bot, its Requester. It is null for built-in rhythms and self-started turns, and editing never changes it. They get no Creator columns.
- Existing rows need no move: `ownerId` already holds the person who answers for each piece of work. Job gains the Creator columns, filled from `SokoBotDelegation` when one exists, else from the Owner.
- The Core API stays backward compatible, and nothing is removed or deprecated. `owner` and `ownerId` keep their meaning and become nullable; they are null only for work without an Owner. `creator` is added to Task Schedules and Jobs. `scope=owned` keeps its name and meaning.
- This ships before shared Soko Bots, which build on it.
