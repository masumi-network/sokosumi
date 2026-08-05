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
