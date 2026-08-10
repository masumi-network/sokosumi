# ADR 0002: Room coworker Thought is shared transcript content, collapsed by default

- Status: Accepted
- Date: 2026-08-10

## Decision

In chat **rooms**, a coworker **Thought** (provider reasoning text for a turn) is part of the shared assistant message: every member who can see the message can see the same live beat and the same **Thought disclosure**. The disclosure is **collapsed by default**. **Mention status** on the parent user message stays lifecycle-only (calling / thinking / replied / failed) and must not carry Thought text.

## Why

Rooms are multi-reader transcripts. Hiding Thought to only the mentioner needs a second ACL and fights transparency. Putting Thought in the mention badge overloads a compact multi-mention chip and mixes lifecycle with content. Always-expanded Thought floods channels. Collapsed shared disclosure gives liveness during the wait and opt-in audit after, without private-to-mentioner complexity.

## Consequences

- Persist Thought with the assistant message (existing metadata path); reload shows the same disclosure.
- No mentioner-only or admin-only Thought UI for rooms without reopening this ADR.
- Tool steps inside the disclosure and Hermes/PA component unification are out of scope of this decision.
