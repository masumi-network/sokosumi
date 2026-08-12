# External channels: channel-only guests via email invite

**Date:** 2026-08-05  
**Status:** Approved for implementation planning  
**Related:** [2026-07-27-chats-api-and-chat-room-schema-design.md](./2026-07-27-chats-api-and-chat-room-schema-design.md), [2026-07-28-chat-rooms-cutover-deprecate-conversations-design.md](./2026-07-28-chat-rooms-cutover-deprecate-conversations-design.md)  
**Approach:** Room discoverability mode + guest membership + room-scoped invitations (Approach 1)

## Goal

Let an organization run **external channels**: named chat rooms owned by the host org where:

- **Org members** treat the channel like a public org channel (browse + self-join).
- **External platform users** (guests) can join **that channel only** via email invite — without becoming org members and without consuming a seat.

Guests keep full participation inside the room (messages, reactions, threads). They never enter the host org as members.

## Non-goals

- Org-level guest / limited collaborator role on `Member`
- Seat or billing changes for guests
- Multi-channel grants from a single invite
- Guests on `public` / `private` channels (only `external`)
- Bridging Slack/Discord or email-only “ghost” participants
- Group directs changes
- Hermes

## Product decisions (locked)

| Decision | Choice |
| --- | --- |
| Guest identity | Existing or new Sokosumi account; not host-org `Member`; no seat |
| Scope | One channel per guest membership row |
| Invite v1 | Email invite → accept / decline |
| Invite links | Shareable multi-use guest links (SOK-770): host mint/revoke; claim → `access=guest` |
| Channel model | Dedicated mode: `discoverability: "external"` |
| Guest powers | Full room participant; **cannot** invite or manage roster/settings |
| Create external channel | Org owner / admin only |
| Invite guests | Any **org member** who is already in the room (`access=member`) |
| Org-side discoverability | Like public: all host-org members browse + self-join |
| Guest product surface | **Always** in chat sidebar under **External**, any active org (not host-org switcher) |
| Pending invites | Shown in External sidebar in v1 |
| Route naming | Room invites under `/v1/chats/.../invitations` (no `guest-` path prefix) |
| Table naming | Guest language OK on invitation table / membership `access` |

## Context (today)

- Channels are `ChatRoom` with `kind: "channel"`, required `organizationId`.
- `discoverability`: `"public"` \| `"private"` (null for directs).
- Access assumes host-org membership + room rules; `ChatRoomUserMember` has no member/guest distinction.
- Org join uses `Invitation` / `OrganizationInviteLink` with seat/billing gates.
- `GET /v1/chats/rooms` is scoped to the active organization only (no cross-org guest mix-in).
- Self-join exists: `POST /v1/chats/rooms/{id}/members/me`.
- Discoverable browse: `GET /v1/chats/rooms/discoverable`.

## Architecture

### Recommendation: Approach 1 (room mode + guest membership)

Extend the existing chat-room stack. Do **not** add org-level guest roles (Approach 2) or a parallel shared-space entity (Approach 3).

```
Host org
  └── ChatRoom (discoverability=external)
        ├── ChatRoomUserMember access=member  (org users)
        ├── ChatRoomUserMember access=guest   (outsiders after accept)
        └── ChatRoomGuestInvitation           (email invite lifecycle)
```

### Access matrix

| Actor | External room |
| --- | --- |
| Host org member (not yet in room) | Browse + self-join (`members/me`); then full member powers in room |
| Host org member in room (`access=member`) | Full channel perms; may invite/remove guests; may leave |
| Guest (`access=guest`) | Read/write room content; leave self; **no** invite, roster rewrite, archive, discoverability change, org APIs |
| Other platform user | No room access (404/403) |
| Guest vs host org | Never creates `Member`; never passes seat checks |

### List / sidebar model (guest surface = B)

- Room rows remain owned by `organizationId` = host org.
- Guests do **not** switch into the host org.
- Chat list becomes:

  **active-org rooms** ∪ **rooms where caller has `access=guest`** ∪ (sidebar) **pending invitations for caller**

- External sidebar section always mounted regardless of `activeOrganizationId`.
- Show host **organization name** on External rows as a label only (not an org switcher target).

## Data model

### `ChatRoom.discoverability`

Extend allowed values:

- `"public"` — unchanged
- `"private"` — unchanged
- `"external"` — org-public for members; guests only via room invitation

Only `kind=channel` may set discoverability (unchanged rule). Only `external` may have `access=guest` members or room invitations.

### `ChatRoomUserMember.access`

- Column: `access String @default("member")` — `"member"` \| `"guest"`
- Invariants:
  - `guest` only when room `discoverability = "external"`
  - `guest` user must **not** be a current host-org `Member` (enforce on accept and on periodic integrity if needed)
  - Org self-join always creates/keeps `access=member`

### `ChatRoomGuestInvitation`

Room-scoped email invitation (table may keep “guest” in the name; API paths do not).

| Field | Notes |
| --- | --- |
| `id` | uuid7; capability token for accept/decline links |
| `roomId` | FK → `ChatRoom`, Cascade |
| `email` | Normalized invitee email |
| `inviterId` | User who sent invite; Restrict or Cascade per existing invite patterns |
| `status` | `pending` \| `accepted` \| `revoked` \| `declined` \| `expired` |
| `expiresAt` | Hard expiry |
| `createdAt` / `updatedAt` | timestamps |
| `acceptedAt` / `acceptedByUserId` | optional audit on accept |

Indexes: `(roomId, status)`, `(email, status)`, unique partial pending per `(roomId, email)` if Postgres partial unique is used (same pattern as other invite uniqueness).

**Not** the Better Auth / org `Invitation` table. No seat/billing hooks.

## API

All under `/v1/chats`. Org `/v1/invitations` stays org-membership-only.

### Room create / discoverability

- `POST /v1/chats/rooms` — allow `discoverability: "external"` for `kind: "channel"`; **owner/admin** only when creating external (stricter than public/private if those allow any member today — external create is owner/admin).
- `GET /v1/chats/rooms/discoverable` — include `external` for host-org members (same as public).
- `POST /v1/chats/rooms/{id}/members/me` — host-org members may self-join external; guests and non-members cannot use this to become guests.

### Room list (breaking additive behavior)

`GET /v1/chats/rooms`:

- Return rooms for active organization (existing), **plus** rooms where the authenticated user has `ChatRoomUserMember.access = "guest"` (any host org).
- DTO additions:
  - `myAccess: "member" | "guest"` (always set on returned rows the user can open)
  - `organizationName: string | null` (required for guest rows so sidebar can label host org)

### Room invitations (host-facing)

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/v1/chats/rooms/{id}/invitations` | Org member in room (`access=member`); room must be `external` |
| `GET` | `/v1/chats/rooms/{id}/invitations` | Same |
| `DELETE` | `/v1/chats/rooms/{id}/invitations/{invitationId}` | Same — revoke pending → `revoked` |

`POST` body: `{ email: string }`.

Reject when:

- Room not external / archived
- Email is already a host-org member (tell them to self-join as member)
- Duplicate active pending for same room+email (400 or return existing pending)
- Caller is guest

### Invitations (invitee-facing)

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/v1/chats/invitations?status=pending` | Signed-in; filter `email` matches user (normalized) |
| `GET` | `/v1/chats/invitations/{id}` | Preview for deep link (signed-in or limited public fields) |
| `POST` | `/v1/chats/invitations/{id}/accept` | Signed-in; email match; creates `access=guest` membership |
| `POST` | `/v1/chats/invitations/{id}/decline` | Signed-in; email match; status `declined` |

Invitee list DTO: `id`, `roomId`, `roomName`, `organizationId`, `organizationName`, `inviter` `{ id, name }`, `status`, `expiresAt`, `createdAt`.

### Membership removal

- Guest may `DELETE .../members/me` (leave).
- Host-side remove guest: existing roster patch or explicit `DELETE .../members/{userId}` — only `access=member` org members in room; cannot be done by guests.
- Removing a guest does not touch org membership (there is none).

### Realtime / notifications

- Room message auth: room membership (`member` or `guest`), or host-org self-join path as today for members.
- Ably: guests authorize for rooms they belong to; no host-org-wide channel grants beyond the room.
- Email: invite notification via `@sokosumi/email` with deep link to accept UI.
- In-room CHAT notifications for guests follow existing mute rules.

## Web UX

### Create

- Channel create flow: third discoverability option **External** with short copy (org can join; outsiders only by email invite). Owner/admin only for external.

### Room settings

- When room is external and viewer is org member in room: **Invite** (email), list pending outbound invitations, revoke.

### Sidebar — External (always visible)

1. **Pending** — from `GET /v1/chats/invitations?status=pending` (accept / decline).
2. **Joined** — guest rooms from extended room list (`myAccess=guest`).

Deep link: `/chat/invites/{id}` (or equivalent) for email; same accept/decline actions.

### Guest chrome

- Full composer / threads / reactions as room participant.
- Hide: invite controls, archive/restore/delete room, discoverability edit, org admin, host billing.
- Do not offer “switch to host organization.”

## Edge cases

| Case | Behavior |
| --- | --- |
| Invite host-org member | 400 — use org channel self-join |
| Invite existing guest same room | 400 or idempotent pending |
| User is guest in room A and member in own org B | OK; External section + B’s rooms both show |
| Accept while already guest in room | Idempotent success |
| Email not registered | Pending until signup with same email, then accept |
| Expired invite | `expired` or reject on accept |
| Room archived | Guests lose access with room; pending invites not acceptable |
| Convert external → public/private | **Block** while any `access=guest`, pending email invite, or live shareable invite link exists |

## Security

- Email match on accept/decline (case-normalized).
- Guests never pass `ensureCanAcceptOrganizationInvitation` / seat paths.
- Rate-limit `POST .../rooms/{id}/invitations` per inviter and per room.
- Room APIs must not assume `activeOrganizationId === room.organizationId` for guest members.
- Strip org directory leakage: guest may see room roster participants as already exposed by channel DTOs; must not list host-org members outside the room.
- Audit: inviter, accept, revoke, decline events via existing logging patterns where applicable.

## Testing (Core-first)

- Create external (owner/admin); non-admin cannot create external.
- Org member self-join external; appears as `access=member`.
- Guest invite → accept → `access=guest`; no `Member` row; no seat decrement.
- `GET /rooms` with another org active still returns guest room + `organizationName`.
- `GET /invitations?status=pending` for invitee; accept/decline transitions.
- Guest cannot invite, patch discoverability, or call host org admin routes.
- Stranger cannot read room messages.
- Reject guest invite for existing host-org member email.

## Implementation order (high level)

1. Prisma: discoverability external, `access` on user member, `ChatRoomGuestInvitation` + migration
2. Core: access helpers, list union, invitation routes, accept/decline, create external gate
3. Email template for room invite
4. Web client regenerate; External sidebar; create/settings; accept/decline UI
5. Auth matrix tests + web smoke for sidebar

## Follow-ups

- Optional: invitee invite history (`status=accepted`)
- Optional: richer decline reasons / re-invite after decline
- Optional: max-uses defaults / analytics for shareable guest links

## Open implementation choices (resolve in plan, not product)

1. Exact Prisma field name: `access` vs `memberKind` — prefer `access`.
2. Whether `GET /rooms` uses one query with OR or two queries merged — prefer clear merge with stable sort.
3. Convert external → other discoverability: **block** while guests or pending invites exist.
4. Public preview fields on `GET /invitations/{id}` when signed out — prefer require auth then show full preview (simpler).
