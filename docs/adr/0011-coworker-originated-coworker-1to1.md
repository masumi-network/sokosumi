# ADR 0011: Coworker may originate an org-scoped coworker 1:1

- Status: Accepted
- Date: 2026-08-21

A coworker API key may create-or-get an org-scoped **coworker 1:1** with an organization member, then post into it. Humans no longer have to open that Direct first.

Unsolicited Direct is treated like a human adding the coworker to a room: originate requires the coworker to be usable in that workspace (whitelist or GRANTED) plus `chat` and `baseURL`. That is stricter than other coworker actor routes, which only check active + capability. Posting into a room the coworker already belongs to stays membership-only.

Personal coworker 1:1s stay user-started. Coworker keys cannot create channels, human Directs, or groups. The target human is `createdByUserId`. Create-or-get uses the same `directKey` as the user-opened room so both actors land on one row, and unarchives if a stale archived row still holds that key.
