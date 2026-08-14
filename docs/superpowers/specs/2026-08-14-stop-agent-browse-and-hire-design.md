# Stop Agent browse and app Hire

**Date:** 2026-08-14
**Status:** Approved for implementation
**Related:** [ADR-0006](../../adr/0006-stop-agent-browse-and-app-hire.md) · [SOK-803](https://linear.app/masumi/issue/SOK-803/stop-browsing-and-hiring-marketplace-agents)
**Glossary:** Agent, Hire, Job, Coworker — `CONTEXT.md`

## Problem Statement

Users can still browse marketplace Agents on `/agents` and Hire them in the app. That marketplace loop should end. Coworkers stay. Existing Jobs must remain reachable. Agent detail should not be advertised, but must remain so it can be removed later without another Job URL migration. API Hire (including Hermes and Coworker) stays.

## Solution

`/agents` shows only the Coworker gallery. Agent detail stays unlisted and read-only (no Hire). Your Jobs list for an Agent stays. New Job pages live at `/jobs/{jobId}` and become the link everyone writes. Old `/agents/{id}/jobs/{jobId}` redirects there. The marketplace app cannot Hire. Core Hire POST, Hermes Hire, and Coworker Hire stay. The public Agent list API and admin Agent tools stay.

## User Stories

1. As a signed-in user, I want `/agents` to show Coworkers only, so I am not offered marketplace Agents to Hire.
2. As a signed-in user, I do not want an “all Agents” catalog, filters, or category browse on `/agents`, so I cannot shop Agents.
3. As a signed-in user, I want the sidebar and mobile “Explore” item to keep opening `/agents`, so Coworker discovery does not move this cut.
4. As a signed-in user, I want Coworker cards on `/agents` to still start a Task, so Coworker work is unchanged.
5. As a signed-in user, I want `/agents/{id}` to still open if I have the URL, so unlisted Agent detail is not deleted yet.
6. As a signed-in user, I do not want a Hire button or create-Job modal on Agent detail, so I cannot start a new Job from that page.
7. As a signed-in user, I do not want related Agents, catalog chips, or gallery links on Agent detail, so the page does not advertise other Agents.
8. As a signed-in user, I want `/agents/{id}/jobs` to list Jobs I already have with that Agent, so I can still find old work.
9. As a signed-in user, I do not want “create Job” or Hire on that list, so the list is history only.
10. As a signed-in user, I want to open a Job at `/jobs/{jobId}`, so Job URLs do not depend on Agent detail surviving.
11. As a signed-in user, I want `/agents/{id}/jobs/{jobId}` to redirect to `/jobs/{jobId}`, so old bookmarks still work and there is one Job page.
12. As a signed-in user, I want History job rows to open `/jobs/{jobId}`, so History uses the canonical URL.
13. As a signed-in user, I want project Job links to open `/jobs/{jobId}`, so projects do not keep the nested path.
14. As a signed-in user, I want Job notifications to open `/jobs/{jobId}`, so notification clicks land on the canonical page.
15. As a signed-in user, I want Job emails to link to `/jobs/{jobId}`, so new mail does not teach the nested path.
16. As a signed-in user, I want an existing in-flight Job to keep running and remain open, so stopping marketplace Hire does not cancel work.
17. As a signed-in user, I want Job outputs, files, refunds, input-required, and share links to keep working, so a Job I already have is fully usable.
18. As a signed-in user, I want public Job share pages to keep working, so I can still share a Job I already ran.
19. As a signed-in user, I do not want a `/jobs` index, so I am not given a second Job list next to History.
20. As a signed-in user, I want typing `/agents/{id}` to show that Agent, so unlisted is not the same as 404.
21. As a signed-in user, I want the Agent name on a Job page to link to `/agents/{id}`, so I can still reach unlisted detail from a Job.
22. As a signed-in user, I do not want the gallery, search, or nav to link to `/agents/{id}`, so Agents are not advertised.
23. As a user creating a Task, I want to pick a Coworker (not Hire an Agent), so Task create stays coworker work.
24. As a Coworker, I want `POST /v1/tasks/{id}/jobs` to still create a Job, so I can still Hire via API.
25. As a Hermes user, I want Hermes to still Hire Agents via the Core API, so the orchestrator can start Jobs on my behalf.
26. As an API client, I want `GET /v1/agents` to keep returning the public catalog, so existing list clients do not break.
27. As an API client, I want `GET /v1/agents/{id}` to keep returning one Agent, so Job pages and clients can still name the Agent.
28. As an API client, I want `POST /v1/agents/{id}/jobs` to still create a Job, so Hire stays available via API.
29. As an API client, I want `GET /v1/jobs` and `GET /v1/jobs/{id}` to keep working for Jobs I already have, so I can still read them.
30. As an admin, I want `/admin/agents` and metadata overrides to keep working, so catalog ops stay this cut.
31. As a vendor admin, I do not want this cut to change Coworker or vendor-grant tools, so vendor work is untouched.
32. As a user with an old email that links to `/agents/{id}/jobs/{jobId}`, I want that URL to redirect to `/jobs/{jobId}`, so already-sent mail still opens the Job.
33. As a user who bookmarked `/agents/{id}`, I want that page to still load, so unlisted detail is not a breaking 404.
34. As a user who bookmarked the catalog filters on `/agents`, I want to land on the Coworker gallery, so the route is not removed.
35. As a new user finishing onboarding, I want any `/agents` fallback to open Coworkers, not a marketplace.
36. As a share-page visitor, I want a CTA to `/agents` to open Coworkers, not a Hire catalog.
37. As a user, I want ratings already on an Agent detail page to still show if they already load, so read-only detail is not gutted.
38. As a user, I do not want to submit a new Agent review as part of a Hire funnel, so review-after-Hire is not a back door.
39. As a future maintainer, I want almost all product links to use `/jobs/{jobId}`, so Agent detail can be deleted later without another URL move.

## Implementation Decisions

- One canonical Job path: `/jobs/{jobId}`. No `/jobs` index.
- `/agents/{id}/jobs/{jobId}` (including modal/right parallel routes that represent that Job) redirect to `/jobs/{jobId}`. Do not keep a second Job renderer.
- `/jobs/{jobId}` reuses the existing Job detail view (full page). Auth and ownership match today’s Job page.
- A single Job href helper (web) and a single Job link builder (Core emails / sync) produce `/jobs/{jobId}`. History, notifications, projects, Job lists, mention links to a Job, and new email `jobLink` values go through those helpers.
- `/agents/{id}/jobs` stays as “your Jobs for this Agent.” Rows in that list link to `/jobs/{jobId}`. No create-Job control.
- `/agents/{id}` stays. Strip Hire, create-Job modal, and any catalog/advertise chrome. Read-only. Optional link from Job detail Agent name → `/agents/{id}`.
- `/agents` drops the marketplace catalog tier (all Agents, filters, categories). Coworker gallery + start-Task stay. Nav href and label stay this cut.
- Close Hire in the marketplace app only (gallery, Agent detail). Do not reject Core create-Job POSTs. Do not block Hermes or Coworker Hire. Task UI keeps assigning Coworkers.
- `POST /v1/agents/{id}/jobs` and `POST /v1/tasks/{id}/jobs` stay.
- `GET /v1/agents`, `GET /v1/agents/{id}`, `GET /v1/categories`, `GET` Job routes, share, refunds, files, input-required, events stay.
- Admin Agent routes and web admin stay.
- No feature flag. No schema drop. No Agent/Job table migration. No Masumi sync teardown.
- Web start-Job actions / hire webhooks must not remain reachable from marketplace UI. Core still accepts Hire if something calls it.
- i18n: remove or stop using catalog/Hire copy on `/agents` and Agent detail. Do not rename “Explore agents” this cut.
- Later (out of this spec): delete `/agents/{id}` and nested Job routes once traffic is on `/jobs/{jobId}`.

## Testing Decisions

Good tests assert what a user or API client can observe: status codes, redirects, hrefs, presence/absence of Hire and catalog, Coworker gallery still starting a Task. Do not assert component trees or copy keys unless that is the product signal.

Modules to test (existing styles):

- Core Job link builder — email `jobLink` is `/jobs/{jobId}`.
- Web `/agents` page — no marketplace catalog tier; Coworker gallery still renders.
- Web `/agents/{id}` — loads; no Hire / create-Job control.
- Web `/jobs/{jobId}` — owned Job renders; unauthorized/unknown Job matches today’s Job auth behaviour.
- Web nested Job URL — redirect to `/jobs/{jobId}`.
- History, notification, and project href helpers — canonical Job path.
- Core POST Hire routes still succeed (no regression).

Prior art: Core `POST /agents/{id}/jobs` and `POST /tasks/{id}/jobs` tests; `createAgentJobForUser` tests; `job-sync` email link tests; web history list href tests; job-detail-redirect tests; agents gallery padding contract tests.

## Out of Scope

- Deleting `/agents/{id}` or the Agent jobs tree
- Renaming `/agents` or “Explore agents”
- A `/jobs` index
- Dropping Agent/Job schema, Masumi registry sync, credit-cost tables, or admin Agent tools
- Closing `GET /v1/agents` (stays public)
- Rejecting Core Hire POSTs
- Stopping Hermes or Coworker Hire
- Changing Coworker whitelist, vendor grants, or chat
- Canceling or hiding existing Jobs
- Migrating already-sent email bodies (redirect covers those URLs)
- Feature flag / gradual rollout

## Further Notes

Seams confirmed. Parent: [SOK-803](https://linear.app/masumi/issue/SOK-803/stop-browsing-and-hiring-marketplace-agents).

Tickets (children of [SOK-803](https://linear.app/masumi/issue/SOK-803/stop-browsing-and-hiring-marketplace-agents)):

1. [SOK-806](https://linear.app/masumi/issue/SOK-806/canonical-job-url-at-jobsjobid) — Canonical Job URL. No blockers.
2. [SOK-805](https://linear.app/masumi/issue/SOK-805/stop-advertising-agents-on-agents) — Stop advertising Agents. No blockers.

[SOK-807](https://linear.app/masumi/issue/SOK-807/close-leftover-app-hire-task-ui) canceled — Coworker Hire is API (`POST /v1/tasks/{id}/jobs`); Task UI does not Hire.
