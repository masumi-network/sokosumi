# Browse agents

Browse agents lets a signed-in user open `/agents` and use the **coworker gallery** (search hero, coworker cards / offers). Catalog marketplace “Browse all agents” is retired (SOK-805).

## Sub-features

- `agents-gallery` loads `/agents` for a signed-in user and shows the coworker gallery shell.
- `agents-search-or-empty` covers search / filter miss (gallery body clears under the hero) or a blank body when no coworkers are returned.
- `agents-detail-deeplink` (optional) opens `/agents/[agentId]` only when you already have an agent id — the gallery does **not** navigate there from a list row.

## How to get to it (user POV)

- Choose **Agents** in app navigation.
- Open `/agents` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)); session healthy.
- `verify-sokosumi doctor` ok.
- Prefer a Neon fork with coworkers; empty coworker list renders nothing under the gallery section (`return null`) — do not invent detail success.

- **Open gallery.** Run `agent-browser open $WEB_URL/agents` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. Page is `/agents` and not `/signin`.
- **Healthy gallery.** Snapshot shows hero **What do you want to get done?** and/or **Your AI coworkers**, plus coworker / offer controls. Do **not** expect **Browse all agents** or catalog links to `/agents/<uuid>`.
- **Search miss (optional).** Type nonsense in the search field (prefer the snapshot textbox ref); expect the gallery body to clear under the hero (no **Your AI coworkers** / coworker cards). Do not expect catalog empty copy (**No agents available** / **No Agents found** are gone).
- **Empty path.** If the gallery body is blank with no search query (no coworker cards), capture screenshot + snapshot and stop — unmet coworker catalog precondition.
- **Detail (optional only).** Deep-link `/agents/<id>` only if you already know an id; gallery click paths do not prove catalog detail.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/browse-agents` then screenshot + `snapshot -i`.

## Gotchas

- `/agents` is coworker-only (`CoworkerGallerySection` + `coworkerService.listCoworkers`); it does not call `GET /v1/agents` for a marketplace list.
- Soft-empty is a blank gallery section, not **No agents available** (that string is gone).
- Hire/run-job and agent-detail from a catalog row are out of scope — gallery shell (+ optional search miss) only.
