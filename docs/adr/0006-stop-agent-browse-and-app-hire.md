# Ban app marketplace Hire; Jobs live at `/jobs/{jobId}`

- Status: Partially superseded by [ADR-0024](./0024-restore-agent-catalog-browse-without-app-hire.md). The app Hire ban remains in force; only the “stop agent browse” decision is superseded.

The app no longer offers **Hire**. Users must not start a new Job from gallery or Agent detail. **Core Hire APIs stay.** **Soko Bot** still Hires via orchestrator `POST /v1/agents/{id}/jobs`. **Coworker** still Hires via `POST /v1/tasks/{id}/jobs`. Task UI assigns a Coworker; it does not Hire an Agent. Existing Jobs stay. Canonical Job URL is `/jobs/{jobId}` so Agent detail can be deleted later without moving Jobs again.

**Why not delete Agent detail now:** Jobs and “your Jobs for this Agent” still hang off `/agents/{id}`. Removal is a later decision.

**Why not a flag:** App marketplace Hire is gone, not paused.

**Why Core Hire stays:** External / API clients still Hire. Soko Bot and Coworker are API clients, not marketplace Hire. Only the app marketplace Hire loop ends.

**Rejected:** Killing `/agents` (Coworker gallery lives there). 404 on Agent detail this cut. Dual-rendered Job pages. New `/jobs` index. Rejecting Core Hire POSTs. Stopping Soko Bot or Coworker Hire.
