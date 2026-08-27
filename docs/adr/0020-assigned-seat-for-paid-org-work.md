# Assigned Seat is required for coworker-paid work in a paid organization

The Seat gate applies only on a **paid** organization (Stripe self-serve or enterprise). An assigned **Seat** is required to spend the organization credit pool and to start coworker-paid work: create a Task, comment on a Task, assign a Coworker, @mention a Coworker, send in a coworker 1:1. Unseated members keep human chat and may **read** existing Tasks. They do not get a personal-credits fallback. Removing a Seat leaves in-flight Tasks in place; the next debit fails closed. On **free**, every member is seated (ADR 0021). Personal workspace is unchanged (no Seat; personal credits).

Rejected: spend-only gate (create then `OUT_OF_CREDITS`); hiding Tasks entirely (they may still open existing ones); pausing or canceling Tasks on unassign; UI-only hide (Hannah and other API clients must get the same 403); applying the gate to free orgs.
