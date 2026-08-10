# Spec: Room coworker Thought (live + Thought disclosure)

**Date:** 2026-08-10  
**Status:** Ready for agent  
**ADR:** [0002-room-coworker-thought-shared-collapsed](../../adr/0002-room-coworker-thought-shared-collapsed.md)  
**Glossary:** `CONTEXT.md` — Mention status, Thought, Thought disclosure  

## Problem Statement

When a user @mentions a coworker (for example Noodles) in a chat room, they wait a long time with only coarse **Mention status** (“Noodles is thinking” → “Noodles replied”) and a static “Thinking...” placeholder on the stream overlay. Real provider reasoning may already stream and may already be stored on the assistant message, but the room UI does not show **Thought** live or as a post-answer **Thought disclosure**. That feels stuck during the wait and offers no way to audit why the answer landed after it arrives.

## Solution

For all room coworker streams (channel mentions, coworker DMs, multi-party rooms with a stream):

1. **Live:** On the coworker stream bubble, while there is no answer body yet, show the latest non-empty Thought beat (line-clamped). If no Thought has arrived yet, keep the existing “Thinking...” fallback. Do not put Thought text in the mention badge.
2. **After answer:** On the coworker assistant message, show a **collapsed-by-default Thought disclosure** (“Thought for {n}s” when timing is known; otherwise an expand label without inventing a duration). Expanding reveals the full stored Thought text.
3. **Durable:** Same disclosure after reload / late join when message metadata already has Thought (and timing when present).
4. **Shared:** Every room member who can see the message sees the same live beat and the same disclosure (Thought is transcript content, not private to the mentioner).

Ship in three slices: live → in-session collapse → durable reload.

## User Stories

1. As a room member who @mentioned a coworker, I want to see the latest Thought beat while they work, so that I know the system is not stuck.
2. As a room member, I want a “Thinking...” fallback when Thought has not started yet, so that empty streams still feel alive.
3. As a room member, I want Thought to update as new beats arrive (latest beat wins, not a growing wall of text), so that the channel stays scannable.
4. As a room member, I want long Thought clipped to a few lines while live, so that multi-reader channels are not flooded.
5. As a room member, I want the answer body to never include Thought mixed into the markdown reply, so that the answer stays clean.
6. As a room member, I want a collapsed Thought disclosure after the reply lands, so that I can open reasoning only when I care.
7. As a room member, I want “Thought for {n}s” when timing is known, so that wait length is legible after the fact.
8. As a room member, I want an expand label without a fake duration when Thought exists but timing is missing, so that we never invent numbers.
9. As a room member, I want no Thought disclosure when the provider sent no Thought, so that we do not show empty chrome.
10. As a room member who reloads the room, I want the same collapsed Thought disclosure when metadata stored Thought, so that transparency survives refresh.
11. As a late joiner, I want to see the same disclosure as others, so that the transcript is shared truth.
12. As a room member, I want Mention status on the parent user message to stay lifecycle-only (calling / thinking / replied / failed), so that multi-mention badges stay compact.
13. As a room member, I do not want Thought text inside the Mention status badge, so that lifecycle and content stay separate.
14. As a coworker DM participant, I want the same Thought behavior as channel streams, so that all room coworker streams feel consistent.
15. As a channel member who did not write the mention, I still want to see Thought on the assistant message, so that room transparency matches the shared transcript model.
16. As a user of i18n, I want existing reasoning copy keys reused where possible (`thoughtForSeconds`, expand/collapse, thinking), so that locales stay consistent.
17. As an implementer, I want pure helpers mapping stream parts + metadata → view model, so that UI tests stay thin.
18. As an implementer, I want Core persist of reasoning + thought timing to remain the source of durable Thought, so that we avoid a new API for v1.
19. As a product owner, I want tools out of the v1 disclosure, so that reasoning ships without waiting on tool-step UI.
20. As a product owner, I want Hermes/PA unification out of v1, so that room work is not blocked on a cross-surface refactor.
21. As a room member, I want expand/collapse of Thought disclosure to be keyboard-accessible, so that the control is usable without a pointer.
22. As a room member on mobile, I want line-clamped live Thought and collapsed disclosure defaults, so that small screens stay usable.
23. As a tester, I want unit tests on the view-model helpers and presentation tests on the message row, so that regressions are caught without flaky live Noodles E2E.
24. As a platform maintainer, I want ADR 0002 respected (shared, collapsed, badge lifecycle-only), so that future “private Thought” or “Thought in badge” ideas reopen the decision explicitly.

## Implementation Decisions

### Product / domain (locked in grill + ADR 0002)

- Job: live liveness **and** post-hoc transparency.
- Scope v1: all **room coworker streams**.
- After answer: Thought disclosure always **collapsed** by default.
- Content: full provider Thought as sent/stored (not inventing CoT the provider never sent).
- Live: latest beat only, line-clamp ~2–3; fallback “Thinking...”.
- Badge: Mention status lifecycle only.
- Audience: all members who can see the message.
- Tools: out of v1 (component shape may leave room for later).
- Empty Thought: no disclosure row.
- Copy: “Thought for {n}s” when timing known; else expand without fake duration.
- Ship slices: (1) live, (2) in-session collapse, (3) durable reload.

### Architecture

- Prefer a **pure message view-model helper** (web chat utils) that, given stream/UI parts and/or room message metadata, returns:
  - answer text (existing extract rules — text only, no reasoning),
  - optional live Thought beat string,
  - optional disclosure payload `{ text, durationSeconds? }`.
- Room message row (or a small presentational child) renders:
  - live beat / Thinking... on stream overlay when answer empty,
  - Thought disclosure above/near answer when disclosure payload present and not in pure-thinking empty state.
- Stream overlay mapping must pass through reasoning parts into the view-model (today `extractMessageContent` strips them for body — keep that for answer; add separate Thought extraction).
- Durable path: read assistant message metadata fields already written by Core (`reasoning` steps + `thought_timing_ms` when present). If client DTO drops metadata needed for Thought, fix mapping so metadata reaches the row — no new endpoint required for v1 if metadata already on the message.
- Mention status UI remains unchanged except not hosting Thought.

### Non-schema preference

- No new Prisma columns required if metadata already holds reasoning + timing.
- No mention lifecycle state machine changes.

### i18n

- Prefer existing `App.Chat.Chat.reasoning.*` keys (`thinking`, `thoughtForSeconds`, expand/collapse steps) over new parallel namespaces; add only if copy gaps appear.

### Accessibility

- Live Thought: `role="status"` / polite live region as appropriate (existing thinking placeholder pattern).
- Thought disclosure: button with `aria-expanded`, visible focus ring.

## Testing Decisions

Good tests assert **external behavior** (what the user/view model exposes), not private React state machine internals.

### Seams (approved)

1. **Room message row (UI)** — props → render: live beat vs Thinking...; collapsed disclosure labels; no disclosure without Thought; answer free of Thought; Mention status unchanged.
2. **Message view-model helpers** — pure functions: parts/metadata → answer + live beat + disclosure; duration only when timing valid; extract answer still excludes reasoning.
3. **Core persist (regression only)** — reasoning + thought timing still stored when provider sends them; only touch if wiring breaks.

### Prior art

- Web: `message-utils` tests (answer strips reasoning).
- Web: `room-message-row` component tests.
- Core: `persist-assistant-to-chat-room` tests for reasoning + `thought_timing_ms`.
- Pattern only (not a hard dependency): Hermes `ReasoningLine` / `MessageSteps`.

### Out of test scope for v1

- Full browser E2E against live Noodles.
- Hermes/PA suite as required gate.
- Multi-tab Ably as a separate product surface.

## Out of Scope

1. Hermes / personal-assistant redesign or mandatory shared component extraction.
2. Tool steps / chips inside Thought disclosure.
3. Thought text inside Mention status badge.
4. Per-user ACL (only mentioner / only admins see Thought).
5. Always-expanded Thought in rooms.
6. Inventing CoT the provider never sent.
7. Changing mention lifecycle states (`pending` / `sent` / `responded` / `failed`).
8. New Core public API solely for Thought if metadata already ships on the message.

## Further Notes

- Provider may only emit **reasoning summaries**; UI shows what is received — that is still Thought in product language.
- Commit-gate / stall-timer work that pass-throughs reasoning is complementary; this spec is about **showing** Thought, not inventing heartbeats.
- Optional follow-ups (not v1): tool steps in disclosure; soft DM default peek; badge elapsed timer only.
- Domain language: use **Mention status**, **Thought**, **Thought disclosure** from `CONTEXT.md`.
)
