# Browse agents

Browse agents lets a signed-in user open `/agents`, use the **Coworker gallery**, and browse the **Agent catalog** tier below it (Cardano / x402, search, category, kind filters). App Hire stays off — catalog cards and Agent detail are read-only (no Hire, no price).

## Sub-features

- `agents-gallery` loads `/agents` for a signed-in user and shows the coworker gallery shell plus the Agent catalog section.
- `agents-search-or-empty` covers search / filter miss for coworkers under the hero, and catalog empty / not-found states when filters match nothing.
- `agents-detail-from-catalog` opens `/agents/[agentId]` from a catalog card (or a known deep-link id).

## How to get to it (user POV)

- Choose **Agents** in app navigation.
- Open `/agents` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)); session healthy.
- `verify-sokosumi doctor` ok.
- Prefer a Neon fork with coworkers and catalog Agents; empty coworker list may render nothing under the gallery section (`return null`).

- **Open gallery.** Run `agent-browser open $WEB_URL/agents` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. Page is `/agents` and not `/signin`.
- **Healthy gallery.** Snapshot shows coworker hero / **Your AI coworkers**, and catalog copy such as **Browse all agents** (or locale equivalent) when Core catalog data is present.
- **Catalog card.** Prefer a catalog row / **Show Details** control that navigates to `/agents/<id>`. Do not expect Hire / Create Job / credits price on catalog cards.
- **Search miss (optional).** Type nonsense in the coworker search field; expect the gallery body to clear under the hero. Catalog has its own search / filters.
- **Detail.** From a catalog card or deep-link `/agents/<id>`: page loads read-only detail with no Hire and no price/credits chrome.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/browse-agents` then screenshot + `snapshot -i`.

## Gotchas

- `/agents` stacks Coworker gallery above an Agent catalog Suspense tier (`getAllCoreAgents` / categories). Failures in the catalog tier must not blank the coworker gallery.
- App Hire remains banned (ADR-0024); Core Hire APIs stay for Soko Bot / Coworker.
- Soft-empty for coworkers is a blank gallery section; catalog uses **No agents available** / **No Agents found** (or locale equivalents).
