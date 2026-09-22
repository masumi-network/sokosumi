# Spec: Thread unread surfacing

**Date:** 2026-09-21
**Author:** Andreas Osberghaus (design), Claude (write-up)
**Origin:** Alexa Kuk in #Sokosumi — "I still notice the notifications don't go away even though I viewed all the channels and am caught up."

## Problem

A reader clears every channel and the sidebar still shows a count. The count is
not wrong: **Room unread** is defined to include non-self replies in Threads the
reader Participates in, and **Room last-read** deliberately does not Look those
Threads. So the number is correct and unclearable by the action the reader just
took, and nothing anywhere in the channel view points at where the unread lives.

The reader's mental model is "the number is on the channel, so reading the
channel clears it". The product's model is "the number is on the channel, but
part of it belongs to Threads". The two disagree, and the product loses.

## Decision

Stop letting a Thread reply mark the channel. Attention moves to the Thread, and
the Thread is given three places to be seen.

1. **Unread reply bar** — the parent message's reply affordance in the main
   transcript becomes an unread state: accent-tinted, weighted, "2 new replies".
   This is what gives a thread unread somewhere to drain to from inside the
   channel.
2. **Inset thread rows** — in the expanded sidebar, unread Threads render nested
   under their channel with a left guide line. Only Threads the reader
   Participates in, only while unread, capped at 3 then `+N more`.
3. **Thread list panel** — already exists and already sorts unread threads
   first. No change needed; it becomes the overflow target the capped inset
   rows point at.

**Core rule:** a Thread reply never marks the channel. The channel row stays
unbolded, because reading the channel genuinely did work.

**Exception:** a **User mention** inside a Thread escalates and marks the
channel too. Being named is urgent enough to break the rule.

### Attention matrix

| Event | Channel row / rail mark | Thread surfaces |
|---|---|---|
| Top-level message | bold + Rail attention pill (6px) | — |
| Reply in a Participated Thread | **nothing** | reply bar, inset row, thread list |
| User mention in a Thread | bold + Rail attention pill (8px primary) | all three |
| Reply in a Muted thread | nothing | nothing |

Muted threads and lurker threads keep behaving exactly as ADR-0013 and ADR-0030
already say. Nothing about Participant or Look gating changes.

### Collapsed rail

The rail has no room for inset rows, so they become the hover flyout on the
channel's rail square: the same rows, each naming its parent message and reply
count. The Rail attention pill keeps its existing vocabulary — 8px primary
mention, 6px neutral unread, mention wins, never a number.

## Conflict with the current domain model

This spec **reverses documented decisions**. `CONTEXT.md` currently lists under
_Avoid_:

- **Room unread** — "a separate Threads badge", "counting lurker thread replies"
- **Thread list** — "Threads badge as a separate count", "treating this as a
  cross-room surface"
- **Unread thread** — "Sorts the thread list; **not a sidebar number**"

Splitting the count and putting thread unread in the sidebar is exactly what
those lines forbid. That is a deliberate reversal, not an oversight, and it
must be recorded as an ADR and written into `CONTEXT.md` before the code
changes — otherwise the next reader finds code and vocabulary disagreeing.

The reversal is narrow: Room unread stops *absorbing* Thread unread. Thread
unread keeps every gate it has (Participant, Look, Mute). No new counting rule
is introduced; an existing sum is separated into its two addends.

## Out of scope (separate plan)

A global cross-room **Threads** destination and an **All unreads** view. Both
are new nav destinations with their own routes, mobile bottom-nav slots, and
empty states, and `CONTEXT.md` explicitly calls the thread list "not a
cross-room surface" — reversing *that* is a second, larger argument than this
one. Land this first; the cross-room inbox reads much better once thread unread
is already a first-class number.

## Non-goals

- Changing Participant, Look, or Mute semantics.
- Changing what a **Room read receipt** ("Seen by") means.
- Changing `showRoomUnreadCount` (ADR-0027): the reader opt-in still governs
  whether a *number* renders beside a channel name. The split changes which
  number, not whether it shows.

## Acceptance

1. Reader is a Participant in a Thread with 2 unread replies and no unread
   top-level messages. The channel row is not bold, carries no rail pill, and
   shows no count. The parent message shows "2 new replies" tinted. An inset row
   appears under the channel.
2. The reader opens the Thread. The reply bar reverts to plain "3 replies", the
   inset row disappears, the thread list unread group empties.
3. A reply in that Thread mentions the reader. The channel row is bold and the
   rail shows the 8px primary pill, in addition to all three thread surfaces.
4. The reader mutes the Thread. All four surfaces go quiet; a mention still
   breaks through to all of them.
5. A lurker (not a Participant) sees none of it, exactly as today.
