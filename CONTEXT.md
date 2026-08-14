# Sokosumi

Shared product language for the Sokosumi monorepo (web, core, packages).

## Language

### Notifications

**Notification**:
An in-app alert about something that happened for the user or their workspace (for example a job update, vendor grant, billing, or system event).
_Avoid_: Message (when meaning an alert), toast (toasts are a delivery mechanism, not the domain object)

**Notification Center**:
The product surface where the user reviews and acts on notifications: the header panel and the full notifications list page.
_Avoid_: Inbox, activity feed (unless intentionally renaming the product surface)

**Account notice**:
A workspace- or account-level call to action that is not itself a notification, but may surface next to notifications in the Notification Center.
_Avoid_: Notification (for this cue), banner (unless referring to a specific layout)

### Header identity

**App chrome**:
The persistent sidebar and header on authenticated pages: nav, membership-visible rooms, Workspace switcher, and Notification Center.
_Avoid_: Topbar, shell (unless meaning the loading frame)

**Workspace switcher**:
The header control that shows the active personal or organization workspace and lets the user switch between them. This is the identity/context control, not the Notification Center entry point.
_Avoid_: Profile menu (unless a separate account menu is introduced), notification avatar

### Chat membership

**Membership-visible rooms**:
The set of chat rooms the current user is a member of and may see in the chat room list (sidebar / chats list). Losing membership removes a room from this set.
_Avoid_: Roster (for this set), channel list (unless referring to a specific UI label)

**Room roster**:
The set of human and coworker members of one open room. Distinct from membership-visible rooms.
_Avoid_: Sidebar rooms, room list (when meaning who is in the room)

**Membership revoke**:
The event that the current user is no longer a member of a room — by remote removal (kick / roster remove) or by voluntary leave. After revoke they must not remain in membership-visible rooms for that room.
_Avoid_: Access revoke (when meaning coworker workspace pilot access, not room membership)

### Chat presence

**Presence**:
Whether a human participant is currently reachable on the product — they have at least one live client connection. App-global (any Sokosumi surface with a live connection), not room-scoped. Multi-device: any connected device makes the person reachable (aggregate by user, not by single connection id).
_Avoid_: Session freshness, last seen (that is a separate timestamp), membership, Ably channel subscribe alone without a presence signal, equating one connection id with one human

**Online**:
Presence state: reachable and recently active in a connected client.
_Avoid_: Logged in, has session, has unread

**AFK**:
Presence state: reachable (still connected) but idle — no recent activity on any connected client that counts for activity.
_Avoid_: Offline, invisible, away (unless product renames the label)

**Offline**:
Presence state: not reachable — no live client connection (after any disconnect grace the system applies).
_Avoid_: AFK, logged out (logout implies offline but offline does not require logout)

**Last seen**:
A coarse timestamp of recent session activity (e.g. org members table). Not the same concept as Presence; must not drive green-dot Online/AFK/Offline.
_Avoid_: Presence, online status

### Chat message body

**Room message body**:
The markdown string stored for a chat room message (what was sent). Presentation may turn some plain text into links without changing the stored string.
_Avoid_: Wire content (implementation jargon), rendered HTML (that is display, not the body)

**Bare domain**:
In a room message body, a plain hostname with optional path, query, or fragment and no URL scheme (e.g. `google.com`, `naturstein-koester.de/path?q=1`). Shown as a clickable link in the room after send; not converted while typing in the composer; not rewritten in storage.
_Avoid_: Autolink (ambiguous with GFM scheme/`www` links), live link (composer does not convert bare domains while typing)

### Chat outbound delivery

**Outbound delivery status**:
The sender-local lifecycle of a message they just sent in a room channel or thread: **pending** (not yet accepted by the server), **confirmed** (server accepted; durable for others), or **failed** (could not be delivered). Other participants only ever see confirmed messages. Distinct from Mention status (coworker @mention lifecycle on a user message).
_Avoid_: Optimistic message (jargon), sending status (when meaning only the composer spinner), delivery receipt / read receipt (those are about other people, not this lifecycle)

**Pending message**:
A room message row shown only to the sender while outbound delivery status is pending. It is not yet a durable server message.
_Avoid_: Temporary message, local-only draft (draft lives in the composer, not the transcript)

**Failed send**:
A room message row whose outbound delivery status is failed. The sender may retry or remove it; it is still not visible to other participants until a retry becomes confirmed.
_Avoid_: Error toast (toasts may accompany failure but are not the domain object), undelivered draft

**Client turn id**:
Opaque identifier the sender client assigns to one outbound send and its retries so the server creates at most one durable room message for that turn in a room. Distinct from the server message id assigned only after the send is confirmed.
_Avoid_: Message id (server id after confirm), request id (transport-level)

**Send queue** (classic channel / thread):
Per-composer single-flight ordering of outbound classic POSTs: at most one in-flight send per channel composer and per thread composer; further sends wait their turn. A failed send does not block the queue. Distinct from coworker stream send.
_Avoid_: Global room lock (channel and thread do not share one queue)

### Chat threads

**Thread**:
A reply chain under one top-level room message (the parent). A parent becomes a thread only after it has at least one non-deleted reply. Not a room and not a membership-visible room.
_Avoid_: Channel, conversation, inbox, treating a thread as a room

**Thread list**:
The per-room list of that room’s threads, shown in the thread side panel. Every thread in the room, sorted with unread replies first, then by last reply. Not an unread-only inbox.
_Avoid_: Unread threads (as the name of this list), inbox, treating this as a cross-room surface

**Look**:
The user’s high-water mark in a Thread: they opened it, and that moment is stored. Distinct from room read state and from posting a reply.
_Avoid_: Replied, participated, lastLookedAt, read receipt. Do not use “looked” in product UI (say unread / mark as read)

**Unread thread**:
A Thread the user has already looked, with at least one non-self reply after that look. A never-looked Thread is not unread — it sorts by last reply only and does not count toward the badge or mark-all.
_Avoid_: Unread (when meaning the room), never-replied, treating open-but-silent as unsubscribed

### Chat coworker thought

**Mention status**:
The lifecycle of a coworker @mention on a user message (calling → thinking → replied or failed). It is not the coworker’s reply body and not Thought.
_Avoid_: Reply status, thinking badge (as the name of the concept)

**Thought**:
The coworker’s reasoning text for a turn (provider reasoning / summary parts), distinct from the answer body. Shown live as the current beat while the turn is open, and after the answer as a Thought disclosure.
_Avoid_: Chain-of-thought (unless product means hidden provider CoT never sent to the client), internal monologue

**Thought disclosure**:
The collapsed control on a coworker assistant message that reveals Thought (and duration when known) after the answer is available or when reloading a message that already stored Thought.
_Avoid_: Reasoning accordion, steps panel (Hermes-specific layout names)
