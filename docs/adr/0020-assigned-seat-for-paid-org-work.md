# Assigned Seat is required for coworker-paid work in a paid organization

- Status: Partially superseded by [ADR-0057](./0057-the-owner-is-the-person-who-answers-for-the-work.md).
  "`ownerId` is the creator" no longer holds: the Owner is the person who
  answers for the work, which for Coworker or Soko Bot work is the person it
  was made for, and work can have no Owner. Everything else stands, including
  that the Organization owns the work and the next debit fails closed.

The Seat gate applies only on a **paid** organization (Stripe self-serve or enterprise). An assigned **Seat** is a license to use the product. Unseated members get **chat only** (human and coworker). Owner and admin also keep **settings, billing, and Seat assignment** so they can recover. Tasks, projects, files, jobs, agents gallery, history, connections, and personal assistant stay in the sidebar but open a Seat-required explanation (Core `organization_seat_required` on those APIs). Coworker and orchestrator actors skip the human product wall so in-flight work can finish. The coworker bills via usage/Task 403. Removing a Seat leaves in-flight Tasks in place, including schedule fire of a Task created while seated (the Organization owns that work; `ownerId` is the creator). The next debit fails closed. On **free**, every member is seated (ADR 0021). Personal workspace is unchanged (no Seat; personal credits).

Rejected: spend-only gate (create then `OUT_OF_CREDITS`); hiding Tasks entirely (they may still open existing ones); pausing or canceling Tasks on unassign; UI-only hide (Hannah and other API clients must get the same 403); applying the gate to free orgs; treating coworker chat as paid work.
