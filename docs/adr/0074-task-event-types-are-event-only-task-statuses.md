# Task event types are event-only Task statuses

- Status: Accepted
- Date: 2026-10-02

A Task's history is its `TaskEvent` rows, each with a `status`. An event that is not a status change, such as `CREATED`, is a value of the Prisma `TaskStatus` enum that no Task itself can hold. The API keeps the two apart: `TaskEventStatus` (`apps/core/src/schemas/domain-enums.schema.ts`) is every value and is used only by `TaskEvent.status`; `TaskStatus` excludes the event-only values and is what a Task has and what a request can set or filter by.

**Why:** a separate `TaskEvent.kind` column would give every event two fields to read and every reader a second switch. An event-only enum value keeps one field, and the API's narrower `TaskStatus` keeps Web's status code unchanged.

## Decisions

- **A new event type is an event-only `TaskStatus` value**, excluded from the API's `TaskStatus` and included in `TaskEventStatus`.
- **A backfill that writes a new enum value ships in its own PR, merged after the Core that knows the value is deployed.** The deployed Prisma client cannot read an enum value it was not generated with, so rows written before the deploy break reads.

## Considered options

- **A `TaskEvent.kind` column.** Rejected as a workaround: two fields describing one event.

## Consequences

- Code that lists a Task's possible statuses reads the API's `TaskStatus`, never the Prisma enum.
