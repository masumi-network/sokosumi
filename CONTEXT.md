# Sokosumi

Shared product language for the Sokosumi monorepo (web, core, apple, cli, packages).

## Language

### Marketplace

**Agent**:
A Masumi-registry marketplace listing. A user hires an Agent to run a Job. Distinct from Coworker.
_Avoid_: Classic agent, bot

**Agent catalog**:
The browse tier on `/agents` under the Coworker gallery: Cardano and x402 Agents with search, category, and kind filters. Discovery only while app Hire is off — no Hire CTA and no price/credits on cards or detail.
_Avoid_: Calling Coworkers Agents in catalog copy, marketplace shop, Hire gallery

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
_Avoid_: Agent (when meaning this), Soko Bot

### Soko Bot

**Soko Bot**:
A user-owned, first-party personal project manager. It helps one user operate Sokosumi, normally by delegating Tasks to Coworkers or hiring Agents to run Jobs. It is neither an Agent nor a Coworker.
_Avoid_: Hermes, orchestrator, Agent, Coworker, bot (when meaning a generic AI actor)

**Delegation**:
Creating, assigning, or managing a Task for a Coworker on the user's behalf. Distinct from hiring an Agent to start a Job.
_Avoid_: Hire (Task → Coworker), execute (the Coworker executes the Task)

**Direct response**:
A Soko Bot answer that does not create or mutate a Task or Job. Used for conversation, clarification, summaries, and advice.
_Avoid_: Self-execution (the Soko Bot manages work; it does not perform delegated work itself)

**Context packet**:
A bounded, point-in-time view of relevant Sokosumi state supplied to a Soko Bot turn, including current workspace, Projects, Tasks, Coworkers, Agents, Jobs, and pending decisions. It is a prompt input, not an authoritative copy of product data.
_Avoid_: Memory, database snapshot

**Soko Bot memory**:
Short-lived working notes maintained for one Soko Bot: active goals, decisions, preferences, follow-ups, and blockers. Product records remain authoritative.
_Avoid_: Context packet, chat history, source of truth

**Legacy Soko Bot history**:
Immutable read-only copy of chat messages created by external Hermes before
first-party Soko Bot cutover. It is shown separately from new Soko Bot turns
and never resumes an Eve session.
_Avoid_: Soko Bot memory, current turn history, Hermes chat (in product UI)

**Pending decision**:
A bounded Soko Bot proposal that needs user approval or clarification after the current turn ends. Accepting it starts a new authorized action; it never leaves a Soko Bot turn parked.
_Avoid_: Paused turn, confirmation card (presentation), Eve approval

### Developers

**Coworker developer**:
A person who builds, runs, and maintains Coworkers. Distinct from an Agent developer and from a user who assigns Tasks.
_Avoid_: Agent developer (when meaning this), calling a Coworker an Agent

**Coworker runtime**:
An external execution environment that runs a Coworker.
_Avoid_: Agent, Agent runtime

**Runtime adapter**:
A bridge between Sokosumi and one Coworker runtime. It is distinct from a Developer CLI skill.
_Avoid_: Agent plugin, Sokosumi plugin (when meaning this)

**Agent developer**:
A person who lists Agents on the Masumi registry for Hire. Distinct from a Coworker developer.
_Avoid_: Coworker developer (when meaning this)

**Developer CLI**:
The in-repo command-line client for Coworker developers and Agent developers. Complements web `/developer`; does not replace it.
_Avoid_: Treating `/developer` as deprecated, a second CLI per persona

### Tasks

**Task Manager**:
The page behind the sidebar item "Tasks": the workspace's Tasks as a board or a list, plus its Jobs.
_Avoid_: Task board, tasks page, kanban (unless a UI label)

**New Task wizard**:
The two-step flow that creates a Task: pick a Coworker or a ready-to-run task, then compose. It opens in place over the current page; it is not a page of its own.
_Avoid_: Task form, new task page

**Selectable status**:
A Task status the acting person or Coworker may move the Task to by hand right now. Core decides the set per Task and per actor; the web only shows it. Input required and Approval required are never selectable by a person: a Coworker sets them.
_Avoid_: Allowed transition, manual status option, status dropdown values

**Status picker**:
The control on a Task that changes its status: a searchable list of the selectable statuses with the current one checked.
_Avoid_: Status select, status dropdown

### Social publishing

**Social account**:
An external publishing identity on a social provider, such as an X account. It may be connected to more than one Project.
_Avoid_: Integration, Project account

**Project social connection**:
A Project's authorization to publish through one Social account. A Project may have multiple connections, including to different accounts on the same provider.
_Avoid_: Social account (when meaning the Project authorization), integration account

**Social accounts**:
The section of a Project's Social module page (`/projects/{id}/social`) where Social connection managers view and manage a Project's Social connections. It is not a Project settings surface and not a Calendar surface.
_Avoid_: Social account (when meaning the external publishing identity), integrations page

**Social connection manager**:
An interactive human user who belongs to a Project's Workspace and may view, connect, reconnect, or disconnect that Project's Social connections. Coworkers, orchestrators, and API keys are not Social connection managers.
_Avoid_: Connector (the person who completed OAuth), automation

**Reconnect social connection**:
Reauthorizing a Project social connection with the same Social account after it needs authentication again. It cannot change the external publishing identity.
_Avoid_: Replace, connect another account

**Replace social connection**:
Disconnecting a Project's current Social account and connecting a different one. It is a deliberate identity change, not reconnecting.
_Avoid_: Reconnect, edit connection

**Social connection audit record**:
A non-executable record of a Project social connection lifecycle event, including the Project, Social account identity, action, actor or scheduler, timestamp, and provider outcome. It never contains OAuth values.
_Avoid_: Active connection, credential log

**Social scheduling authorization**:
The consent granted when a Social account is connected that lets the Project's scheduler publish through that Project social connection until it is disconnected.
_Avoid_: Per-post approval, connector approval

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
One chronological list of the user's notifications, shown in the header panel and on the full notifications page. Reading is the only change a reader makes to a Notification; a reader never removes one.
_Avoid_: Inbox, activity feed (unless intentionally renaming the product surface), clear or delete (when meaning a reader removing notifications)

**Needs you**:
The Notification Center view that lists only Notifications whose request is still open on the record they point at: a task or job paused on input, a pending vendor grant or coworker access request. Answering the request is what removes a row; reading it does not. One row per waiting record, the newest.
_Avoid_: Actionable inbox, to-do (this is a lens over Notifications, not a task list), unread (a read row still needs the reader until answered)

**Mentions** (Notification Center view):
The Notification Center view that lists only Notifications for a User mention of the reader, and their reminders, read or not. A direct message is not a mention and stays out; an @mention written inside a Direct is one. Its tab counts the mentions still unread, so reading one lowers the count and leaves the row.
_Avoid_: Inbox, mentions badge (that is the room's sidebar count), counting direct messages as mentions

**Account notice**:
A workspace- or account-level call to action that is not itself a notification, but may surface next to notifications in the Notification Center.
_Avoid_: Notification (for this cue), banner (unless referring to a specific layout)

**OS banner**:
The operating-system alert shown for a Notification on a device, whether Sokosumi is open or closed.
_Avoid_: Push notification (when meaning the banner itself), toast (toasts are in-app only), browser notification

**Push opt-in**:
A user's explicit consent to receive OS banners while Sokosumi is closed; one switch per user, with device registrations underneath.
_Avoid_: Notification opt-in (that phrase gates email today), subscription (when meaning consent)

### Header identity

**App chrome**:
The persistent sidebar and header on authenticated pages: nav, membership-visible rooms, Workspace switcher, and Notification Center.
_Avoid_: Topbar, shell (unless meaning the loading frame)

**Workspace switcher**:
The header control that shows the active personal or organization workspace and lets the user switch between them. This is the identity/context control, not the Notification Center entry point. It only lists workspaces the user actually has. If they have no personal workspace, it offers an explicit create action — it does not create one by switching.
_Avoid_: Profile menu (unless a separate account menu is introduced), notification avatar

### Account access

**Security check**:
The human check on public account-email entry points (sign-up, sign-in, password reset, magic link, verification resend, email change), not on OAuth sign-in. Usually invisible; it asks for interaction only when the visitor looks automated.
_Avoid_: Captcha, Turnstile (in product copy), bot check

**Impersonation**:
A platform admin acting as a non-admin user in a full one-hour session, started from the admin user overview with a required reason. Badged by a persistent "Acting as {name} ({email})" banner with an Exit control on every app page; every start is audit-logged with actor, target, and reason, and every stop with actor and target (stopping takes no reason by design).
_Avoid_: Login as, switch user, mask

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

### Project pins

**Pinned project**:
The current user's personal pin of a project they can read. Not shared, and not capped — but the sidebar's Projects flyout is five rows in total, so pins claim those slots first and the rest are reached through `All projects`. Product UI: Pin / Unpin; the API and database say star ([ADR-0036](docs/adr/0036-project-pins.md)). Activity never moves a Pinned project, and there is no reorder mode: the order is `starredAt` ascending, which here really is the time of pinning. Pinned from the projects list row or the project header, never from the flyout, which is a shortcut rather than a place to curate. Closing a project keeps the pin but drops it out of the flyout, so reopening restores it. Distinct from a Pinned room and a Pinned message.
_Avoid_: Starred project (API-only name), favorite, treating this as a Pinned room

**Recently visited project**:
A project this reader opened, newest first, tracked per device rather than on the server. Fills whatever flyout slots their Pinned projects leave, ahead of a backfill in activity order. Distinct from the activity order the projects list uses: `lastActivityAt` is derived from task, job and project events, so opening a project does not move it and the two orders disagree on purpose.
_Avoid_: Recent project (says nothing about whose), active project, last activity

### Billing

**Seat**:
A purchased place on a **paid** Organization (Stripe self-serve or enterprise) that can be assigned to one Member. Assignment is a license to use the product (Tasks, projects, files, jobs, spend). It is not a private credit grant. Purchased count is the cap on assigned Seats: if it drops, the newest seated members lose the Seat immediately and the oldest stay. On **free**, every member is seated; there is nothing to assign. Unseated members can use **chat**. Other product areas stay in the sidebar but explain that an assigned Seat is required. Owner and admin also keep settings, billing, and Seat assignment. A Task created while seated stays org work: schedule fire continues; the unseated creator cannot open it. Coworkers must check whether they can bill (usage / Task writes fail closed without a Seat).
_Avoid_: License, slot (unless a UI label), workstation, treating a Seat as a personal credit balance, treating Task assignee as a human, unpaid seat flags, unlimited-on-free as an admin control

**Organization credit pool**:
Credits owned by an Organization. Free period grant is the free monthly amount (250), shared by every member. Paid self-serve period grant is purchased seats × credits per seat, spent by assigned Seats. Enterprise keeps its own shared pool. OTC/admin grants sit in the same pool. Distinct from personal credits.
_Avoid_: Org balance (ambiguous with Stripe), member credits, seat credits (that reads as a private per-member grant), scaling the free 250 by member count

**Personal credits**:
Credits owned by a User with no Organization. Spent only in a personal workspace.
_Avoid_: Account credits, default credits, treating these as spendable in an organization workspace

### Chat rooms

**Channel**:
A named, organization-owned chat room people join by membership, not by participant set. Distinct from a Direct.
_Avoid_: Room (all chats are rooms), conversation

**Channel slug**:
The unique handle for a Channel in its organization (`#team-soko`). The create UI collects the handle first; the display name is derived from it (`team-soko` → `Team Soko`) and can be edited before submit. After create the slug is stable: renaming the Channel does not change it. Name and slug need not match. Directs have none.
_Avoid_: Room slug (Directs have no slug), treating the slug as the Channel’s identity (that is `id`), vanity URL, requiring the slug to match the name, regenerating the slug on rename

**Channel topic**:
An optional short description of what a Channel is for. Distinct from the Channel name and Channel slug. Absent when unset or blank. Directs have none.
_Avoid_: Description, purpose, bio, treating a Direct as having a topic

**Channel tile**:
How a Channel identifies itself in the collapsed sidebar rail: the first letters of its name on a neutral 20px square, the size every mark in this sidebar is. A private, external, or matched Channel carries its kind as a small corner mark; a public one carries none. A Direct shows participant faces instead: up to three overlapping when several people are in the room, the first alone on the rail, where a 32px square cannot hold the rest and the tooltip already names them. Every mark in this sidebar is 20px — both faces and the tile, the Soko Bot row's face included — because a filled circle that fills the 24px slot edge to edge outweighs the 16px hairline glyph a Channel row carries beside it. An expanded stack pays 2px of leading padding a lone face does not, so its first face lands on the same line: the slot centres a mark narrower than itself, while a stack is wider and starts flush at the slot's edge. The rail drops that padding again, because the extra faces are gone there. The expanded list keeps the plain kind glyph beside the name.
_Avoid_: Channel avatar (Channels have no image), channel icon (nothing is chosen by a person), a colour per Channel (tried, five hues repeat across a dozen Channels and the repeats read as meaning), showing it beside the name in the expanded list

**Sidebar row**:
Any one-line item in the app sidebar: Soko Bots, a nav destination, a chat section heading, a room row, an archived row. One height in both states — 32px with a pointer, 44px on the phone sheet, which is never the rail — so an ordinary row keeps its vertical position when the sidebar toggles and only the panel's width changes. Its leading mark sits in one 24px slot centred 28px from the sidebar's left edge, and its label starts on one column at 48px; the mark keeps its horizontal position across the toggle too. The slot's left edge is what is fixed, not its width: a group Direct's stack of up to three faces grows it to the right, so that row's first face still sits on the axis and only its name starts later than the column. Height and slot belong to the row primitive (`SidebarMenuButton`, `SidebarRowSlot`), not to each list, so a new kind of row cannot drift from the rule. The one separator in the list, under New Task, stays on the rail with them: it sets the one action apart from the destinations, and dropping it there moved everything below it. Not a Sidebar row: the 64px header, the account chip (footer chrome pinned to the bottom edge, 48px, its face still on the 28px axis), and four items that may differ between states because a 32px row cannot hold what they say — a guest room's host organisation line, a pending External invitation's card with Accept and Decline, a section's empty text, and a room's inset unread Thread rows ([ADR-0037](docs/adr/0037-thread-unread-leaves-room-unread.md)). The first three still use the slot and the label column. The inset Thread rows sit under their room's row rather than in it, present only while a Thread is unread and never more than three and an overflow row; the rail has no room for them, so there they ride a flyout beside the room's mark, in place of its name tooltip.
_Avoid_: A taller featured row, a card in the row list, a per-list leading box, a mark that grows outward from its centre (the toggle then slides it), a gap between rows (the rail has none), zero movement as the goal (the four exceptions still shift what is below them)

**Rail attention pill**:
The collapsed sidebar rail's single attention mark, a short bar on the rail's left edge beside a room's Channel tile or Direct avatar: 8px primary for an unread User mention or direct, 6px neutral for Room unread (including marked unread), none when read or Muted. Mention wins; never two marks and never a number. Off the mark itself, so the presence dot and the kind corner mark keep their corners. Derived from the same attention rules as the expanded row's bold and badge. A pending External invitation rides the rail the same way: the Channel tile the room will have once joined, under the 8px primary pill, because an invitation is addressed to the reader. Pressing it expands the sidebar, where Accept and Decline live.
_Avoid_: Unread badge, attention dot, notification dot, a second mark for mention plus unread, a mark on the expanded list

**Rail selection bar**:
The collapsed sidebar rail's mark for whatever the reader has open — a Chat room or a nav destination such as Tasks or Projects: a 20px primary bar on the rail's **right** edge, pointing at the panel it opened. The mirror of the Rail attention pill, which owns the left edge, so a room can be both unread and open without the two marks arguing. How it looks belongs to `SidebarRailSelectionBar`; *when* it shows is each rail list's own call, so every rail item states itself the same way without the primitive guessing what "open" means for a row. Collapsed, every rail item is one 32px square (the logo, Soko Bots, nav, rooms and the account chip alike) and the rail's neutral fill belongs to hover alone (drawn as a ring around that square, deepened on press) — `--muted`, `--accent` and `--sidebar-accent` are one value in dark, so hover, selection and the Channel tile's own plate all read as the same 15% wash. Decorative; `aria-current` already announces it.
_Avoid_: Active pill, selected dot, a left-edge selection bar (that edge is the attention pill's), a selected fill or tile recolour on the rail

**Rail section header**:
A chat sidebar section's heading on the collapsed sidebar rail: one 32px square holding the section's icon (Channels `#`, External a building, Direct Messages a speech bubble, Archived a box), named by its tooltip, which opens and closes the section there as the titled heading does expanded. Every section has one, so the sections below keep their place when the sidebar toggles. It stands where the expanded heading's row stood, so it also marks where one section ends and the next begins. Dimmed while its section is closed. A closed section that holds something for the reader says so on its heading, by the rules its rooms follow: the Rail attention pill beside the rail square, bold on the expanded title; a pending External invitation counts as a mention. Archived's square is the one that expands the sidebar instead of opening in place: its rows never reach the rail, because they are static and their Restore and Delete live in a menu no 32px square has room for, so opening it there would dim a square and show nothing.
_Avoid_: Forcing sections open on the rail, a hairline divider between sections, the globe as the External icon (that is the Channel tile's corner mark), archived rows on the rail, a section with no rail square (everything under it then jumps on a toggle)

**Unreads filter**:
The chat list's switch between All and Unreads: on, it keeps only rooms with Room unread or an unread Thread, with Pinned always shown. The reader's choice is remembered per browser — one value for every organisation, shared by the sidebar and the phone's Chats page — and never flips by itself: with nothing unread it stays on and the list reads All caught up.
_Avoid_: Inbox, unread view, resetting to All when caught up, a per-organisation or per-account setting

**Rail actions**:
What the collapsed sidebar rail lets the reader do: go somewhere (a nav destination, a Chat room), open or close a chat section, and expand the sidebar (the logo, a pending External invitation's tile, or the Archived section's square). Everything that changes a room or makes one lives in the expanded sidebar only: the room menu (mark unread, pin, mute, edit, leave), Create channel, Browse channels, Start a Direct, and an invitation's Accept and Decline. A 32px square has no room for a second control beside its mark, and one press on the logo brings all of them back. Decided, not an oversight.
_Avoid_: A right-click or long-press room menu on the rail, a `+` square under a Rail section header, Accept and Decline in a rail popover

**External channel**:
A Channel that host-organization members can browse and join, and that people outside that organization can join only as a Guest — without becoming organization members and without a seat.
_Avoid_: Public channel (host-org only), guest channel, shared channel

**Guest**:
A platform user on one External channel’s room roster who is not a Member of the host Organization. Scope is that channel, not the organization. They keep their own workspace; they do not switch into the host organization.
_Avoid_: External user, outsider, limited collaborator, org guest (there is no org-level guest role)

**Direct**:
A chat room whose identity is its participant set, not a Channel name. Self Direct, human 1:1, multi-human group, coworker 1:1, or personal assistant 1:1. Has no Channel slug. A group Direct may carry a Group name; the name labels it but never identifies it.
_Avoid_: Conversation (retired), treating a DM as a Channel

**Group name**:
An optional shared label on a group Direct, seen by every member in place of the member list. Any member may set, change, or clear it while the Direct is not archived, and each change is recorded in the room with who made it. Clearing it restores the member list. A Direct is a group Direct because it was started for three or more humans, so one that later shrinks keeps its Group name. Naming does not turn the Direct into a Channel: it stays under Direct Messages, private, slug-free, and keeps its members; starting a Direct with the same people opens the named one ([ADR-0040](docs/adr/0040-group-name-is-separate-from-stored-room-name.md)).
_Avoid_: Channel name, nickname (a Group name is shared, not per-reader), room title

**Self Direct**:
One private Personal Direct per user for notes and to-dos, with that user as its sole human member and no AI members. Identified by a canonical self key, not by remaining member count. Shared across available workspaces without requiring a personal Workspace. Created on demand, survives Organization exit, and is removed by account deletion. Shown as “You”; sending notes triggers no self-notifications or AI work.
_Avoid_: Notes channel, per-workspace self-chat, treating a former group with one remaining member as Self Direct

**Send to yourself**:
A room message action that posts a quote of that message into the sender's own Self Direct. The quote remembers its source room, so opening it follows the Message link. The copied author and snippet stay after the user loses access to the source room; only the link stops working. Not offered inside the Self Direct itself.
_Avoid_: Forward, share, bookmark, saved message

**Quote**:
A durable copy of one room message (author, snippet, first attachment) carried on another room message. It stays after the source is edited, deleted, or no longer readable. A quote from another room remembers its source room, and opening it follows the Message link. A user may quote across rooms only when they can read the source room and every user member of the target room is a member of it too, so the snippet never reaches someone who cannot follow the link. Pasting a Message link into the composer turns it into the pending quote; removing that quote puts the plain link back. A quote can be the whole message, with an empty body, except in a Coworker 1:1, which needs words to answer. Coworkers and Soko Bots quote within one room only.
_Avoid_: Reply (that is a thread), forward, Unfurl of an internal link, quoting into a room with readers outside the source room

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
The chat sidebar section for External channels. Distinct from Channels and Direct Messages. Shown when that set is non-empty. Guest rooms appear in every workspace. Human Directs list under Direct Messages, including Personal Directs with a Guest.
_Avoid_: External channel (that is the room), guest sidebar

### Chat membership

**Membership-visible rooms**:
The set of chat rooms the current user is a member of and may see in the chat room list (sidebar / chats list) for the current workspace. The list shows that whole set. Losing membership removes a room from this set.
_Avoid_: Roster (for this set), channel list (unless referring to a specific UI label)

**Room roster**:
The set of human and coworker members of one open room. Distinct from membership-visible rooms.
_Avoid_: Sidebar rooms, room list (when meaning who is in the room)

**Self on Channel roster**:
A Member who creates a Channel or saves its host-org roster stays on that room roster. They cannot omit themselves in the member picker. They leave with Leave, or another member removes them. The last remaining member cannot leave.
_Avoid_: Permanent creator, unchecking yourself as Leave

**Membership revoke**:
The event that the current user is no longer a member of a room — by remote removal (kick / roster remove), voluntary room leave, or because they left or were removed from the host Organization for a room owned by that Organization. After revoke they must not remain in membership-visible rooms for that room.
_Avoid_: Access revoke (when meaning coworker workspace pilot access, not room membership)

**Organization exit (chat)**:
When a user leaves or is removed from an Organization, they lose every chat room membership on rooms owned by that Organization (channels and org directs, including external). They do not keep host-org rooms as guests. Personal rooms and rooms of other organizations are unchanged. Rejoining the organization does not restore prior room memberships. Channels left with no human members are soft-archived; empty org directs are removed so a new direct can be created later. Rooms left with no human members also lose their pending guest invitations and live invite links.
_Avoid_: Soft demote to guest on org leave (retired for org exit), cascade-strip other guests when last host exits org (not part of this rule)

### Chat pins

**Pinned room**:
The current user's personal sidebar pin of a membership-visible room. Not shared. Product UI: Pin / Unpin; a Pinned room of any kind lists under the sidebar's Pinned section only, in the reader's own order, and activity never moves it. The reader changes that order in the section's reorder mode (a handle per row: drag, or arrow keys); outside it a pinned row is an ordinary row. That order is the membership's `starredAt` ascending, which a reorder rewrites (`PUT /chats/rooms/starred`) for the rooms of the sidebar it was made in only (a room in several sidebars, like a Personal Direct, has one key and moves in each), so `starredAt` is a sort key, not the time of pinning. Distinct from a Pinned message.
_Avoid_: Starred room (API-only name), favorite, treating this as a Pinned message

**Pinned message**:
A top-level Channel message on that Channel's shared pin list. Everyone on the room roster sees the same list. Distinct from a Pinned room.
_Avoid_: Announcement (a use of this), pinned room, thread pin

### Chat reactions

**Reaction**:
One user's emoji on one room message. The user, the message and the emoji identify it; there is no separate reaction id. A user either has a given Reaction or does not.
_Avoid_: Toggle (the old API verb), like, vote

**Pending reaction**:
The sender-local add or remove of a Reaction shown before the server confirms it. It overlays that emoji only; it is dropped on confirm, rolled back to the last confirmed state on failure, and never seen by other participants. Distinct from a Pending message.
_Avoid_: Optimistic reaction (jargon), local reaction

### Chat presence

**Presence**:
Whether a human participant is currently reachable in the **active organization** — they have at least one live client connection on that workspace. App-shell (any Sokosumi surface with a live connection, not chat-page-only), not room-scoped. Other organizations see Offline. Multi-device: any connected device in that organization makes the person reachable (aggregate by user, not by single connection id).
_Avoid_: Session freshness, last seen (that is a separate timestamp), membership, Ably channel subscribe alone without a presence signal, equating one connection id with one human, treating presence as reachable in every org at once

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

**Channel link**:
In a room message body, a `#` immediately followed by a membership-visible Channel’s current name or slug (no space after `#`). Presentation shows it as a clickable link to that Channel after send; the stored markdown is unchanged. Distinct from User mention: no stored mention row, no paging. The composer `#` picker inserts a chip that looks like a User mention but serializes to this plain text; it is not a stored mention row.
_Avoid_: Channel mention (that reads as User mention), hashtag, linking a Direct, treating `# Heading` (space after `#`) as a Channel link, Message link

**Message link**:
A URL that opens a room and jumps to one specific room message, for a reader who can already read that room. Distinct from a Channel link, which is `#name` or `#slug` in a room message body. Not a public share.
_Avoid_: permalink, public share, Channel link, vanity slug URL

**Unfurl**:
A page-preview card scraped from a URL in a room message body and stored on that message. The same cards for every viewer. Distinct from the URL in the body.
_Avoid_: Metadata preview, embed when meaning this card, treating the body link as the unfurl

**Removed unfurl**:
An unfurl the message's human author took off the message. Gone for everyone. The body URL stays. It stays gone while that URL remains in the body. Not a body edit. Not a personal hide.
_Avoid_: Hidden unfurl, dismissed Quote, edited message, composer opt-out

**Unfurl snapshot**:
Sokosumi's own stored copy of an unfurl's preview image, taken when the unfurl is scraped. The card shows the snapshot, never the source image.
_Avoid_: Cached image, proxied image, hotlinked image, og:image (when meaning the copy)

**Message image gallery**:
The distinct image attachments of one room message, in body order across all its attachment rows, stepped through one at a time in the image viewer. Never other file kinds, a quote's or unfurl's image, or another message's images.
_Avoid_: Lightbox, carousel, room gallery (the gallery is one message, never the room), slideshow

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
The per-room list of that room’s threads, shown in the thread side panel. Every thread in the room, sorted with unread threads first, then by last reply. The overflow target for the sidebar's capped inset rows. Still per-room: not a cross-room inbox.
_Avoid_: Unread threads (as the name of this list), treating this as a cross-room surface

**Look**:
The user’s high-water mark in a Thread: they opened it, and that moment is stored. Distinct from Room last-read and from being a Participant. Look clears; it does not opt a lurker into unread. Opening the Thread, posting a reply, or Mark all threads Looks it. Advancing Room last-read does not Look.
_Avoid_: Replied, Participant, lastLookedAt, Room read receipt (that is a different mark on a different table). Do not use “looked” in product UI (say unread / mark as read)

**Room last-read**:
The user’s high-water mark on a room’s main transcript. Distinct from Look. Advancing it clears Room unread and that room’s mention badge; Thread unread is untouched, because clearing that is Look's job ([ADR-0037](docs/adr/0037-thread-unread-leaves-room-unread.md)).
_Avoid_: Look, lastReadAt (storage), treating this as reading Threads

**Room read receipt**:
Which members of the Room roster have advanced their Room last-read past a given moment. Shown as **Seen by**: in the newest message's bottom-right corner, the three most recent readers plus a `+N` — grey and unringed until hovered, and opening a list of who read it, when, and who has not. The room header carries the same faces larger, but that stack is the whole roster, the viewer and the machines included, merely *ordered* by read recency so the four that fit are the freshest readers; its `+N` counts the room, not the readers. Derived from Room last-read alone — nothing new is stored and nothing is asked of the reader. Humans only: Coworkers and Soko Bots are never counted. Driven by the roster, so a member who left stops counting. A Guest viewer on an External channel sees no read times at all; host members still see the Guest’s. Marked unread stays private and does not rewind it. Says nothing about Threads — that is Look.
_Avoid_: Look, delivery receipt, last seen, Room unread, treating a face as “read your reply”
Rides the existing room channel under its own event name, published by Core and marked ephemeral: the client only subscribes, so unlike Typing ([ADR-0033](docs/adr/0033-typing-rides-its-own-ephemeral-channel.md)) it needs no second channel and no capability change.

**User mention**:
A human @-reference to a user on a room message (main transcript or Thread). Distinct from Mention status (coworker turn lifecycle).
_Avoid_: Mention status, ping (unless UI copy), treating a coworker thinking-state as this

**Participant**:
A user of a Thread who authored the parent, has a remaining reply in that Thread, or is the target of a remaining user mention on the parent or a remaining reply. Distinct from Look. A user mention makes them a Participant immediately. Neither room mute nor a Muted thread blocks it. Live on remaining messages: delete the last own reply or the only mention and it drops, unless another path still holds.
_Avoid_: Follower, subscriber, treating Look (opened it) as participation

**Room unread**:
The count of unseen non-self top-level messages in this room after Room last-read. Replies in Threads do not count — they are Thread unread, and they surface on the Thread ([ADR-0037](docs/adr/0037-thread-unread-leaves-room-unread.md)). A User mention inside a Thread is the one exception: it marks the room as well. Replies from before the user joined the room do not count. Drives sidebar **bold**, and a numeric affordance shown unless the reader switches it off (`hideRoomUnreadCount`, shown by default, [ADR-0038](docs/adr/0038-room-unread-count-is-on-by-default.md); [ADR-0027](docs/adr/0027-room-unread-count-is-a-reader-opt-in.md) for why it is separate from the mention badge). Not the mention badge.
_Avoid_: Attention, attentionReplyCount, counting thread replies, counting lurker thread replies, using the mention badge as the message unread count

**Unread thread**:
A Thread the user is a Participant of, with at least one non-self reply they have not cleared. Never-looked still counts if they are a Participant. A Muted thread does not count, unless a remaining reply mentions them. Sorts the thread list, tints the parent message's reply bar, and renders as an inset row under its channel in the sidebar (capped at 3, then an overflow row into the thread list). It is the room's second number, beside Room unread and never folded into it.
_Avoid_: Unread (when meaning the room), never-replied, treating Look-without-Participant as unread, attention threads, folding this into Room unread

**Muted thread**:
A Thread one reader silenced. It stops counting toward Thread unread and stops writing CHAT notifications for them, while they stay a Participant ([ADR-0030](docs/adr/0030-thread-mute-overrides-participant.md)). A user mention on a reply still breaks through. Unmute also Looks the Thread, so the silenced stretch does not arrive at once. Per reader and per Thread; not the room mute.
_Avoid_: Unfollow, unsubscribe, leave thread, room mute, treating it as dropping out of Participant

**Mark all threads**:
A per-room action that Looks every unread Thread the user Participates in. Does not mark the main transcript read. Does not Look lurker Threads.
_Avoid_: Mark room as read, Mark all notifications

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

### Chat typing

**Typing**:
A human room member is composing a message to a room's main transcript right now. Live and ephemeral: never stored, never replayed, and it lapses on its own when the person stops, so a closed tab or a dropped connection clears itself without anyone sending a stop. Every room, Channels and Directs alike. Humans only — a coworker's turn is announced by Thought. Per person, not per device: the same person typing on two devices is typing once.
_Avoid_: Presence (reachability in the organization, not activity in one room), Draft (a saved composer string that outlives the session and is restored on open — restoring one is not Typing), Thought (a coworker's reasoning), Online, treating an attachment or an emoji picker as Typing (the signal is about text, so that it never lies)

**Typing line**:
How a room says who is Typing: one name, two names, or the fact that there are more than two. Named in the order people started, so a new typist joins the end rather than resorting the line; somebody who went quiet long enough to disappear and then types again is starting afresh, and joins the end. Sits below the composer where there is already room beneath it, and above the composer where there is not — narrow layouts, where it holds its space, because the composer must not move under someone mid-sentence. Either way it costs the transcript nothing it was not already spending. The open room only — Typing never reaches the sidebar, where bold, the mention badge and the Rail attention pill already compete for a row.
_Avoid_: "N users are typing" (rooms hold people, and a count is not what the reader wants), an animated indicator (it reads as a coworker thinking), a Typing dot on a sidebar row, spelling out three or more names (they truncate, and a truncated name is worse than none)
