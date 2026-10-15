# Work has an Owner only when it is private

- Status: Accepted
- Supersedes: "`ownerId` is the creator" in [ADR-0020](./0020-assigned-seat-for-paid-org-work.md)
- Date: 2026-10-15

Every Task, Task Schedule and Job had one required `ownerId`. It did four jobs at once: it recorded who made the work, it was the only reader of private work, charges and the Seat check ran on it, and it decided who was notified. Soko Bots shared by a Project or an Organization ([SOK-1356](https://linear.app/masumi/issue/SOK-1356/soko-bots-owned-by-an-organization-or-a-project)) act for many people and sometimes for nobody, so code had to invent an Owner, and the invented one went wrong: a schedule deleted together with its member, a stale fallback Organization owner, one person @mentioned on every team rhythm.

Now an Owner exists exactly when work is private, and SQL enforces it: `(visibility = 'PRIVATE') = ("ownerId" IS NOT NULL)`. Public work has no Owner; it belongs to its workspace. Three other roles take over what the Owner used to do:

- **Creator**: the person, Coworker or Soko Bot that made the work (`creatorUserId`, `creatorCoworkerId`, `creatorSokoBotId`).
- **Requester** (`requestedByUserId`): the person a Coworker or Soko Bot acted for, or the member who resumed a Task Schedule whose person left. A record only; it grants no access and no rights.
- **Responsible person**: computed, never stored. The Owner, otherwise the human Creator, otherwise the Requester. Work a Soko Bot started on its own has none, and neither has public work whose person deleted their account.

## Considered Options

- **Keep a required Owner and attribute shared-bot work to a member.** This is what the first shared-bot stack did. It needs a chain of fallbacks to pick the member, and every link in it can point at the wrong person.
- **Make the Owner nullable but keep it on all work a person makes.** A smaller migration, but the Owner would still mean creator, reader and payer at once, and every rule would still have to ask whether it is null.
- **Make Task participants the readers of private work.** That turns a following list into an access list: an @mention would grant access to private work.
- **A Requester column on charges.** It would always equal `Transaction.userId`, because the Requester is the responsible person whenever there is one.

## Consequences

- The responsible person replaces the Owner for charges and the Seat check, the "my work" filter (`scope=mine`), notifications, a Coworker's reach, moving work to another workspace, and Job writes. Core returns `responsibleUserId`, `creator` and `requester`; Web decides no right from `owner`.
- Work nobody is responsible for comes from Soko Bots acting on their own and from public work whose person deleted their account. It is charged to the Organization pool with `Transaction.userId` null and no Seat check. A Soko Bot's work is capped by `proactiveDailyLimit`. Deleting an account pauses the public Task Schedules that person was responsible for, so nothing keeps spending with nobody behind it; the member who resumes one becomes its Requester. Any seated member may edit such work; deleting, moving or refunding it needs an Organization owner or admin.
- The Owner is the person who creates private work, or its Requester when a Soko Bot or Coworker creates it. Visibility stays fixed after creation, so an Owner is never added or removed later.
- A Job has an Owner only when its Task is private. Job gains the Creator columns.
- The Requester is added as a Task participant when the work is made. Task participants stay followers and grant no access.
- Deleting a user deletes only the private work they own. Their public work stays: `creatorUserId` and `requestedByUserId` become null, and the Creator check relaxes to "at most one", where none means a deleted person. In-flight Jobs they are responsible for still block deletion.
- `SokoBotSchedule`, `SokoBotTurn` and `SokoBotPendingDecision` rename `userId` to a nullable `requestedByUserId`. It is null for built-in rhythms and self-started turns, and editing never changes it. They get no Creator columns.
- Existing rows move once, and the move cannot be undone. On public Tasks and Task Schedules, the Owner moves into `requestedByUserId` where a Coworker or Soko Bot made the work, then `ownerId` is cleared. On Jobs, the Creator comes from `SokoBotDelegation` when one exists, else from the Owner, and the Owner is cleared unless the Task is private.
- The Core API stays backward compatible, and nothing is removed. `owner` and `ownerId` on Tasks, Task Schedules and Jobs stay and carry the responsible person, so existing clients see the same value as before for every kind of work that existed then. They become nullable, because public work whose person deleted their account has nobody responsible for it, and neither does work a Soko Bot started on its own; only then are they null. `scope=owned` stays an alias of `scope=mine`. All of these are marked deprecated in the OpenAPI document. No sunset date is set; removing them needs its own decision.
- This ships before shared Soko Bots, which build on it.
