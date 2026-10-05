# ADR 0047: Run now is a Run that the end-after-N count ignores

- Status: Accepted
- Date: 2026-10-01
- Amends: [ADR 0041](0041-recurring-rules-move-to-task-schedule.md)

**Run now** adds one extra Run to an Active or Paused Task Schedule. It is a row in the Run ledger, released at once and marked as manual, so the schedule's history and the calendar show when it created work. It leaves the rule alone: planned Runs keep their times, and the Run does not count toward an end-after-N rule. The Task is built from the blueprint the same way a rule Run's Task is, and the Run row's actor columns record the person or Coworker who pressed Run now.

**Why:** "Run now" in cron tools and CI means one more execution, not using up the next one. A Monday report must still arrive on Monday after someone ran it on Friday. If the manual Run counted toward N, pressing it would quietly remove a planned Run.

## Considered options

- **Pull the next Run forward** — rejected. It uses up a planned Run, and moving a single Run is already possible with move.
- **A Task from the blueprint with no Run row** — rejected. No migration, but the glossary already calls this a Run, and the history and calendar would leave out work the schedule created.

## Consequences

- The projection and end-after-N logic must count rule Runs only. A manual Run never becomes planned, skipped, or moved.
- Run now is revision-checked like the other schedule writes, so a double submit creates one Task.
