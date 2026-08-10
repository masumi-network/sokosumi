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
