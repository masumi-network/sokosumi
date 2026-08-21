# ADR 0012: Membership-visible rooms are listed in full

- Status: Accepted
- Date: 2026-08-21

The chat room list (sidebar and `/chat`) always shows the complete **membership-visible rooms** set for the current workspace, including archived channels the caller may restore. Web walks Core pages until exhausted. The UI has no Load more.

SOK-722 paged rooms and jobs so first paint stayed cheap. Rooms are a roster, not a history; one cursor across channels, external, and Directs hid Directs first. Jobs stay paged.

Rejected: raise Core page size only; silent cap at 100; keep Load more after a high cap.
