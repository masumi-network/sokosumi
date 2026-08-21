# Sokosumi

Shared product language for the Sokosumi monorepo (web, core, packages).

## Language

### Marketplace

**Agent**:
A Masumi-registry marketplace listing. A user hires an Agent to run a Job. Distinct from Coworker.
_Avoid_: Classic agent, bot

**Hire**:
Starting a Job on an Agent.
_Avoid_: Purchase, subscribe (billing), assign (Task → Coworker)

**Job**:
One run of an Agent for a user or workspace. Not a Task.
_Avoid_: Task, run (unless a UI label)

**Task**:
Work assigned to a Coworker. Not a Job.
_Avoid_: Job, run (unless a UI label), treating a Task as an Agent hire

**Coworker**:
A vendor AI actor for Tasks and chat. Discovered on `/agents`. Not an Agent; not hired.
_Avoid_: Agent (when meaning this), assistant (Hermes)

### Task payments

**Task payment claim**:
The Cardano escrow payment record for a Task.
_Avoid_: Purchase (Job hire), x402 payment

**Task x402 payment**:
The x402 signed-authorization charge for a Task. The parent is the Task; do not drop that from the name while this is a Task-scoped record.
_Avoid_: X402Payment (unmarked), x402 payment (when meaning the payment node's attempt), treating this as a Job hire payment

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
The header control that shows the active personal or organization workspace and lets the user switch between them. This is the identity/context control, not the Notification Center entry point. It only lists workspaces the user actually has. If they have no personal workspace, it offers an explicit create action — it does not create one by switching.
_Avoid_: Profile menu (unless a separate account menu is introduced), notification avatar

### Workspaces

**Personal workspace**:
A user-owned workspace (no Organization). At most one per user. Optional — created only when the user chooses personal as their first workspace, or later adds one. Not created on signup and not required for invitees who join an organization. It can be deleted only when the user still has at least one organization workspace.
_Avoid_: Default workspace, account workspace, personal organization

**Organization workspace**:
The workspace owned by an Organization. Created with that Organization. Members act in it through organization membership, not by owning the workspace row.
_Avoid_: Team workspace (unless the product renames it), company account

**First workspace**:
The first workspace a user can act in after signup: either a personal workspace they create, an organization they create, or an organization they join via invitation. Until it exists, they cannot use the product. After it exists, they cannot return to zero workspaces.
_Avoid_: Default workspace, home workspace, onboarding workspace

**Identity onboarding**:
The hard-gated post-signup flow for a user who does not already have a first workspace. First screen: confirm display name (prefilled when known) and choose Personal vs Organization. Personal creates a personal workspace. Organization runs the create-organization wizard; the product becomes usable once that organization exists (wizard step 0). Creating an organization does not require a verified email. Users who join via invitation or join link skip it.
_Avoid_: Onboarding (retired intro slides + plan checkout), account setup, onboardingCompleted (removed — first workspace is the state)

**Workspace gate**:
The dedicated authenticated route used when the user cannot use the product yet. It is where they resolve pending organization invitations and join links, or complete identity onboarding. No app chrome. Leaving is sign out or finish.
_Avoid_: Onboarding page, welcome, accept-invitation as a separate post-signup product (the gate owns that moment)

### Chat rooms

**Channel**:
A named, organization-owned chat room people join by membership, not by participant set. Distinct from a Direct.
_Avoid_: Room (all chats are rooms), conversation

**External channel**:
A Channel that host-organization members can browse and join, and that people outside that organization can join only as a Guest — without becoming organization members and without a seat.
_Avoid_: Public channel (host-org only), guest channel, shared channel

**Guest**:
A platform user on one External channel’s room roster who is not a Member of the host Organization. Scope is that channel, not the organization. They keep their own workspace; they do not switch into the host organization.
_Avoid_: External user, outsider, limited collaborator, org guest (there is no org-level guest role)

**Direct**:
A chat room whose identity is its participant set (1:1 or multi-human group), not a Channel name. Human 1:1, multi-human group, or coworker 1:1.
_Avoid_: Conversation (retired), treating a DM as a Channel

**Coworker 1:1**:
A Direct with exactly one human member and exactly one coworker.
_Avoid_: Channel @mention thread, mixing extra humans or coworkers into this shape

**Org Direct**:
A Direct owned by an Organization. Human 1:1 is an Org Direct only when both people are Members of that Organization. Organization exit removes the leaving member from them.
_Avoid_: Team DM, workspace DM

**Personal Direct**:
A Direct not owned by an Organization. Survives Organization exit. Human 1:1 from a shared External channel is a Personal Direct; coworker 1:1 may also be personal.
_Avoid_: Account DM, global DM

**External** (sidebar):
The chat sidebar section for External channels and for Directs whose other human is not a Member of the active Organization (or there is no active Organization). Distinct from Channels and Direct Messages. Shown when that set is non-empty; those Directs and Guest rooms appear in every workspace.
_Avoid_: External channel (that is the room), guest sidebar

### Chat membership

**Membership-visible rooms**:
The set of chat rooms the current user is a member of and may see in the chat room list (sidebar / chats list) for the current workspace. The list shows that whole set. Losing membership removes a room from this set.
_Avoid_: Roster (for this set), channel list (unless referring to a specific UI label)

**Room roster**:
The set of human and coworker members of one open room. Distinct from membership-visible rooms.
_Avoid_: Sidebar rooms, room list (when meaning who is in the room)

**Membership revoke**:
The event that the current user is no longer a member of a room — by remote removal (kick / roster remove), voluntary room leave, or because they left or were removed from the host Organization for a room owned by that Organization. After revoke they must not remain in membership-visible rooms for that room.
_Avoid_: Access revoke (when meaning coworker workspace pilot access, not room membership)

**Organization exit (chat)**:
When a user leaves or is removed from an Organization, they lose every chat room membership on rooms owned by that Organization (channels and org directs, including external). They do not keep host-org rooms as guests. Personal rooms and rooms of other organizations are unchanged. Rejoining the organization does not restore prior room memberships. Channels left with no human members are soft-archived; empty org directs are removed so a new direct can be created later. Rooms left with no human members also lose their pending guest invitations and live invite links.
_Avoid_: Soft demote to guest on org leave (retired for org exit), cascade-strip other guests when last host exits org (not part of this rule)

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
