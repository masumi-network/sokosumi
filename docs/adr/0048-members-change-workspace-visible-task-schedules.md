# ADR 0048: Every member changes a workspace-visible Task Schedule

- Status: Accepted
- Date: 2026-10-01
- Amends: [ADR 0041](0041-recurring-rules-move-to-task-schedule.md)

Any member who can see a Task Schedule can change it: edit, pause, resume, end, delete, Run now, and skip, move, or restore a Run. A PUBLIC schedule is therefore open to every seated member of its workspace's organization. A PRIVATE schedule is still seen and changed only by its owner. Acting on a schedule does not change hands: the owner stays the owner of the schedule and of every Task its Runs create, and the Run row records who acted. A Coworker reaches what the member it acts for reaches, still limited to schedules it created or whose assignee is in its vendor family.

Core returns `canWrite` on every schedule it sends, so clients show the actions without restating the rule.

**Why:** a PUBLIC Task can already be edited and archived by every member of its organization (`buildTaskWriteAccessWhere`). The owner-only schedule rule claimed to copy the Task rule but did not. While the owner is away, nobody else can pause or fix a schedule that does the team's work. Ownership decides who may read a PRIVATE schedule, so it cannot move to whoever edited last.

## Considered options

- **Keep delete owner-only** — rejected. End already stops a schedule for good, and delete keeps the Tasks it made (their `scheduleId` becomes null). A second rule for one action protects little.
- **Coworkers keep the acting member's own schedules only** — rejected. A Coworker would reach less than the member it acts for.
- **Coworkers reach every schedule the member reaches** — rejected. One vendor's Coworker could then change schedules that run another vendor's agents.
- **Web derives the rule from `ownerId`** — rejected. This is how the owner-only rule drifted into two apps.

## Consequences

- Personal workspaces are unchanged: nobody else is a member there.
- The organization Seat gate applies to every caller, as before, and also to calendar reads.
- An edit by another member may keep the schedule's Soko Bot assignee, even when it is the owner's personal assistant. Assigning a Soko Bot anew still follows the acting member's own rules for that bot.
- The owner gets no notification when someone else changes the schedule. The schedule's revision and the Run rows' actor columns show what happened.
