# Stop marketplace Agent browse and app Hire; Jobs live at `/jobs/{jobId}`

The marketplace no longer offers **browse or Hire in the app**. Users must not discover Agents on `/agents` or start a new Job from gallery or Agent detail. **Core Hire APIs stay.** **Hermes** still Hires via orchestrator `POST /v1/agents/{id}/jobs`. **Coworker** still Hires via `POST /v1/tasks/{id}/jobs`. Task UI assigns a Coworker; it does not Hire an Agent. Existing Jobs stay. Canonical Job URL is `/jobs/{jobId}` so Agent detail can be deleted later without moving Jobs again.

**Why not delete Agent detail now:** Jobs and “your Jobs for this Agent” still hang off `/agents/{id}`. Unlisted detail + list stay this cut; removal is a later decision.

**Why not a flag:** App marketplace Hire is gone, not paused.

**Why Core Hire stays:** External / API clients still Hire. Hermes and Coworker are API clients, not marketplace browse. Only the app marketplace loop ends.

**Why `GET /v1/agents` stays public:** Web catalog is removed; the list API is not. Admin Agent tools stay.

**Rejected:** Killing `/agents` (Coworker gallery lives there). 404 on Agent detail this cut. Dual-rendered Job pages. New `/jobs` index. Rejecting Core Hire POSTs. Stopping Hermes or Coworker Hire.
