# Apple chat parity

## Resume checkpoint

- Current slice: **09a — coworker streaming in Directs**, branch `codex/apple-direct-streaming`. Implementation and local verification complete; draft [PR #4352](https://github.com/masumi-network/sokosumi/pull/4352) awaits CI/review and human merge.
- Slice 08 merged in [PR #4340](https://github.com/masumi-network/sokosumi/pull/4340). Apple CI passed on final head `94c416caf`, including review fixes 1–5. Remaining review nits and the hidden-room read product question were not changed.
- Next: open/review the 09a PR and wait for human merge. Do not start 09b before 09a merges.
- The recurring “Continue Apple chat after PR changes” automation remains deleted. Coordinate ownership before resuming from another app.

## Scope and audit baseline

Iteration 0 approved and merged in [PR #4303](https://github.com/masumi-network/sokosumi/pull/4303). Audited web and Apple source at `85d85776deaa128a3d4177bb58b6545684e7c1ac` (2026-09-09). This document is the chat parity boundary for subsequent PRs. It expands the original tracer scope to the chat capabilities below, implementing the goal in [VISION.md](VISION.md) without authorizing unrelated web product screens.

Target macOS 26 now, iOS 17+ later. Use SwiftUI native navigation and controls. All models, networking, view models and persistence belong in platform-agnostic, UI-free packages. Shared packages target macOS 26 and iOS 17, per the baseline update requested after iteration 0. Shared code must remain available on iOS 17; verify this with an iOS 17 build. Newer Mac APIs belong only in Mac-specific views, guarded by platform/availability checks. Isolate unavoidable AppKit behind a Mac adapter. Do not add dependencies or change the shared API contract without a separate PR and explicit approval. Never modify `apps/web`.

“Conversation” includes channels, human/group Directs, coworker Directs and personal-assistant Directs exposed by web chat. “Reply thread” means replies under a parent message, not the whole conversation. Chat guest access and the existing Drive attachment picker are explicitly in scope. Linked non-chat destinations open on web; their native screens are not implied.

## Status and iteration rules

- **Partial**: existing Apple implementation covers part of the row; complete parity and current build/test evidence are still required.
- **In review**: implementation and verification recorded below; awaiting PR merge.
- **Todo**: no complete Apple slice found. **Blocked**: record a concrete ambiguity or missing API and ask the user before implementing. **Done**: merged PR, matching behavior, clean build and passing tests with new feature coverage recorded here. **N/A**: web-only concern.
- No capability is marked Done solely by the initial source audit. Existing tests are evidence of intent, not fresh execution results.
- Read in numeric order (09a before 09b); dependency IDs are prerequisites. Pick the earliest unfinished row whose dependencies are complete after rebasing on `main`. Each row is a proposed feature slice, not a license to omit its sub-capabilities.
- One complete vertical slice (model, networking, view and tests) per PR. If a row contains genuinely independent features, record child IDs and dependencies here before splitting. Size alone is not a reason to split.
- Update the row with PR link, exact verification commands/results and remaining gaps. Describe feature, linked web sources, included/excluded behavior and how to test. Open draft by default.
- Iteration 0 must receive user approval before implementation. Later iterations wait for merge; poll `gh pr view --json state,reviews`, read review comments, address them and re-request review. If closed unmerged, stop and ask. No next slice before merge.

## Dependency-ordered capability inventory

Source links are relative to this file. The shared web service boundary is [chat-room.service.ts](<../web/src/lib/services/chat-room.service.ts>); chat mutations are in [actions.ts](<../web/src/app/(app)/chat/actions.ts>). Check their Core calls before each slice rather than porting web server actions into Swift.

| ID | User-facing capability / acceptance scope | Depends on | Status | Web source files |
| --- | --- | --- | --- | --- |
| 01 | Sign in through system-browser OAuth; cancellation, errors, restore session, refresh/revocation, sign out. Move session state and persistence into portable packages; isolate the presentation adapter. | — | Done — [#4304](https://github.com/masumi-network/sokosumi/pull/4304) | [form.tsx](<../web/src/app/(auth)/signin/components/form.tsx>), [page.tsx](<../web/src/app/(auth)/auth/callback/signin/page.tsx>) |
| 02 | Workspace access gate, personal/org selection and restoration, unseated chat access, workspace switch with isolated room/draft state. Setup-required state opens web. | 01 | Done — [#4309](https://github.com/masumi-network/sokosumi/pull/4309) | [workspace-access-gate.tsx](<../web/src/app/(app)/components/workspace-access-gate.tsx>), [workspace-switcher.tsx](<../web/src/app/(app)/components/user-avatar/workspace-switcher.tsx>), [workspace.service.ts](<../web/src/lib/services/workspace.service.ts>) |
| 03 | Conversation sidebar: all membership-visible pages, Channels/Directs/External groups, names, avatars, participant ordering, selection, activity order, empty/loading/error/retry, collapsed sections. | 02 | Done — [#4312](https://github.com/masumi-network/sokosumi/pull/4312) | [organization-chat-list.client.tsx](<../web/src/components/chat/organization-chat-list.client.tsx>), [partition-rooms-for-sidebar.ts](<../web/src/components/chat/partition-rooms-for-sidebar.ts>), [chat-room-sidebar-row.tsx](<../web/src/components/chat/chat-room-sidebar-row.tsx>), [direct-room-avatar-stack.tsx](<../web/src/components/chat/direct-room-avatar-stack.tsx>) |
| 04 | Room timeline: ordered paginated history, older-page loading without losing position, grouping, sender/avatar/time, local day separators, membership events, deleted/edited labels, empty/error/retry; follow latest without stealing reading position. | 03 | Done — [#4313](https://github.com/masumi-network/sokosumi/pull/4313); native scrolling accepted by user | [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [use-stick-to-bottom.ts](<../web/src/app/(app)/chat/hooks/use-stick-to-bottom.ts>), [load-room-messages.ts](<../web/src/app/(app)/chat/load-room-messages.ts>) |
| 05 | Read/attention state: visible resolved history marks read, failed/hidden loads do not; unread mentions, manual unread and residual thread attention remain accurate. | 04 | Done — [#4322](https://github.com/masumi-network/sokosumi/pull/4322) | [use-room-read-attention.ts](<../web/src/app/(app)/chat/hooks/use-room-read-attention.ts>), [room-attention.ts](<../web/src/components/chat/room-attention.ts>), [room-read-overlay.ts](<../web/src/components/chat/room-read-overlay.ts>) |
| 06 | Compose and send classic room messages: multiline input, Enter/Shift-Enter and IME behavior, whitespace/length checks, pending/sent/failed feedback, single-flight ordering, duplicate reconciliation, retry/remove. | 04 | Done — [#4325](https://github.com/masumi-network/sokosumi/pull/4325) | [room-message-composer.tsx](<../web/src/components/chat/room-message-composer.tsx>), [composer-wysiwyg-editor.tsx](<../web/src/components/chat/composer-wysiwyg-editor.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [classic-outbound-queue.ts](<../web/src/app/(app)/chat/utils/classic-outbound-queue.ts>) |
| 07 | Live room updates: full DTO, ID hydration and patches, create/edit/delete/reaction/pin changes, own-send reconciliation, reconnect/poll recovery, membership revocation and capability refresh, workspace/account isolation. Reply routing lands with 08. | 05, 06 | Done — [PR #4327](https://github.com/masumi-network/sokosumi/pull/4327) | [use-chat-room-realtime.tsx](<../web/src/lib/ably/use-chat-room-realtime.tsx>), [apply-chat-room-message-patch.ts](<../web/src/lib/ably/apply-chat-room-message-patch.ts>), [use-chat-membership-revoked-control.tsx](<../web/src/lib/ably/use-chat-membership-revoked-control.tsx>), [use-chat-refresh-scheduler.ts](<../web/src/components/chat/use-chat-refresh-scheduler.ts>), [use-selected-room-channel-health.ts](<../web/src/lib/ably/use-selected-room-channel-health.ts>) |
| 08 | Reply threads: parent preview, open/back/close, paginated replies, independent composer and outbound queue, reply counts/activity, loading/error states, thread read marking and live routing of replies and parent updates between the room and the open thread. | 05, 06, 07 | Done — [PR #4340](https://github.com/masumi-network/sokosumi/pull/4340) | [thread-panel.tsx](<../web/src/app/(app)/chat/components/thread-panel.tsx>), [thread-list-panel.tsx](<../web/src/app/(app)/chat/components/thread-list-panel.tsx>), [chat-room-message-scope.ts](<../web/src/app/(app)/chat/utils/chat-room-message-scope.ts>), [parent-thread-preview.ts](<../web/src/app/(app)/chat/utils/parent-thread-preview.ts>) |
| 09a | Coworker streaming in Directs: initial send, incremental text/reasoning, thinking/error state, active-stream resume on room entry and persisted-message reconciliation without flicker/duplicates; preserve web room eligibility and send lock. | 07 | In review | [use-coworker-direct-room-stream.ts](<../web/src/app/(app)/chat/hooks/use-coworker-direct-room-stream.ts>), [coworker-thought-ui.tsx](<../web/src/app/(app)/chat/components/coworker-thought-ui.tsx>), [route.ts](<../web/src/app/api/chat/route.ts>), [route.ts](<../web/src/app/api/chat/[roomId]/stream/route.ts>) |
| 09b | Coworker streaming in reply threads: reuse Direct streaming with parent association, route overlays and persisted replies to the correct thread, resume with the correct parent and preserve the shared send lock. | 08, 09a | Todo | [use-coworker-direct-room-stream.ts](<../web/src/app/(app)/chat/hooks/use-coworker-direct-room-stream.ts>), [coworker-thought-ui.tsx](<../web/src/app/(app)/chat/components/coworker-thought-ui.tsx>), [route.ts](<../web/src/app/api/chat/route.ts>), [route.ts](<../web/src/app/api/chat/[roomId]/stream/route.ts>) |
| 10 | Rich message text: paragraphs/line breaks, headings, lists/task lists, tables, quotes, emphasis/underline/strike, links, inline/fenced code with highlighting, emoji/emoticons and jumbo emoji, expand/collapse long content, selection/copy. | 04 | Partial | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [room-mention-markdown.tsx](<../web/src/app/(app)/chat/components/room-mention-markdown.tsx>), [markdown.tsx](<../web/src/components/markdown.tsx>), [jumbo-emoji.ts](<../web/src/app/(app)/chat/utils/jumbo-emoji.ts>) |
| 11 | Draft restoration scoped by account/workspace/room/thread, selected mentions and attachments, clear on successful submission; formatting toolbar preference. | 08 | Partial | [use-compose-draft.ts](<../web/src/app/(app)/chat/hooks/use-compose-draft.ts>), [compose-draft-storage.ts](<../web/src/app/(app)/chat/utils/compose-draft-storage.ts>), [format-toolbar-preference-storage.ts](<../web/src/app/(app)/chat/utils/format-toolbar-preference-storage.ts>) |
| 12 | Rich composing: bold/italic/underline/strike, inline/block code, quote, ordered/unordered lists, insert/edit link, emoji picker/emoticons, formatting shortcuts and toolbar visibility. | 06, 10 | Todo | [composer-wysiwyg-editor.tsx](<../web/src/components/chat/composer-wysiwyg-editor.tsx>), [composer-format-toolbar.tsx](<../web/src/components/chat/composer-format-toolbar.tsx>), [composer-add-link-dialog.tsx](<../web/src/components/chat/composer-add-link-dialog.tsx>), [emoji-picker.tsx](<../web/src/components/chat/emoji-picker.tsx>) |
| 13 | Mentions: people/coworker/personal-assistant suggestions and chips, @all, channel suggestions/navigation, mention serialization, profile details and open Direct from participant. | 06, 10 | Todo | [room-composer.tsx](<../web/src/app/(app)/chat/components/room-composer.tsx>), [composer-suggestions.ts](<../web/src/components/chat/composer-suggestions.ts>), [room-mention-markdown.tsx](<../web/src/app/(app)/chat/components/room-mention-markdown.tsx>), [chat-participant-hover-card.tsx](<../web/src/app/(app)/chat/components/chat-participant-hover-card.tsx>) |
| 14 | Attachments: choose/drop/paste files where supported, room-scoped upload grants, type/size validation, upload/error feedback, removable draft chips and markdown serialization, attachment-only send, convert overlong message into text file. Match stream/classic eligibility. | 06, 10, 11 | Todo | [room-composer.tsx](<../web/src/app/(app)/chat/components/room-composer.tsx>), [room-file-drop-zone.tsx](<../web/src/app/(app)/chat/components/room-file-drop-zone.tsx>), [chat-room-file-upload.client.ts](<../web/src/lib/utils/chat-room-file-upload.client.ts>), [user-file-upload.client.ts](<../web/src/lib/utils/user-file-upload.client.ts>) |
| 15 | Attachment rendering: file chips and metadata, image previews, open/download, inline audio/video and safe links; maintain content order with text. | 14 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [room-message-segments.ts](<../web/src/app/(app)/chat/utils/room-message-segments.ts>), [markdown.tsx](<../web/src/components/markdown.tsx>), [file-chip-mini-preview.tsx](<../web/src/components/ui/file-chip-mini-preview.tsx>) |
| 16 | Attach existing Drive file using the chat picker (browse/search/select and availability/errors only). This explicitly includes the attachment picker, not standalone Drive management. | 14 | Todo | [room-composer.tsx](<../web/src/app/(app)/chat/components/room-composer.tsx>), [drive-file-picker.tsx](<../web/src/components/drive/drive-file-picker.tsx>), [attachment-submenu.tsx](<../web/src/components/drive/attachment-submenu.tsx>) |
| 17 | Quote a message in room/reply composer, preview/dismiss, submit quote reference, expand quoted content and jump to source. | 08, 10 | Todo | [room-composer.tsx](<../web/src/app/(app)/chat/components/room-composer.tsx>), [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>) |
| 18 | Edit own eligible messages: prefilled composer, save/cancel, validation, edited timestamp and failure rollback. | 10, 12 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 19 | Delete eligible messages with confirmation; preserve tombstones, thread context and authorization/error behavior. | 07, 08 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 20 | Emoji reactions: picker, add/remove, counts, own selection, participant names and optimistic rollback. | 07 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [emoji-picker.tsx](<../web/src/components/chat/emoji-picker.tsx>) |
| 21 | Pinned messages: pin/unpin, list, loading/empty/error, jump to message and realtime updates. | 07 | Todo | [pinned-messages-panel.tsx](<../web/src/app/(app)/chat/components/pinned-messages-panel.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 22 | Link unfurls: title/description/image, open link, authorized remove action and errors. | 10 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 23 | Room search: query, result previews/highlights, pagination, jump and context loading, empty/error states. | 04, 10 | Todo | [room-search-panel.tsx](<../web/src/app/(app)/chat/components/room-search-panel.tsx>), [use-room-message-jumps.ts](<../web/src/app/(app)/chat/hooks/use-room-message-jumps.ts>), [room-search-jump.ts](<../web/src/app/(app)/chat/utils/room-search-jump.ts>) |
| 24 | Thread overview: room thread list, workspace unread threads, previews/counts, open target, mark one/all read. | 07, 08 | Todo | [thread-list-panel.tsx](<../web/src/app/(app)/chat/components/thread-list-panel.tsx>), [unread-threads-panel.tsx](<../web/src/app/(app)/chat/components/unread-threads-panel.tsx>), [thread-overview-unread.ts](<../web/src/app/(app)/chat/utils/thread-overview-unread.ts>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 25 | Message/thread deep links including notifications and quote/search targets: fetch surrounding history, select room/parent, highlight target and handle missing/forbidden targets. | 08, 23 | Todo | [use-message-param-jump.ts](<../web/src/app/(app)/chat/hooks/use-message-param-jump.ts>), [use-room-notification-deep-link.ts](<../web/src/app/(app)/chat/hooks/use-room-notification-deep-link.ts>), [use-room-message-jumps.ts](<../web/src/app/(app)/chat/hooks/use-room-message-jumps.ts>) |
| 26 | Conversation actions: pin/unpin a conversation in the sidebar (web label Pin, Core star routes; message pins are row 21), mute/unmute, mark unread with optimistic rollback and sidebar ordering/attention. | 05, 07 | Todo | [chat-room-sidebar-row.tsx](<../web/src/components/chat/chat-room-sidebar-row.tsx>), [organization-chat-list.actions.ts](<../web/src/components/chat/organization-chat-list.actions.ts>) |
| 27 | Start Direct: search/select recipients, existing Direct reuse, org human groups, one-to-one coworker and personal assistant restrictions, loading/failure, first-message handoff. | 06, 09a | Todo | [create-direct-dialog.tsx](<../web/src/app/(app)/chat/components/create-direct-dialog.tsx>), [open-direct-with-participant.ts](<../web/src/app/(app)/chat/components/open-direct-with-participant.ts>), [use-open-coworker-room.tsx](<../web/src/app/(app)/chat/components/landing/use-open-coworker-room.tsx>), [direct-create-shape.ts](<../web/src/app/(app)/chat/utils/direct-create-shape.ts>) |
| 28 | Chat start surface: pick coworker/start chat, pending first message, recent conversation navigation, availability notices. Native empty/start UI replaces the web layout; the landing's task statistics strip and search-agents CTA are excluded (see Out of scope). | 03, 27 | Todo | [chat-landing.tsx](<../web/src/app/(app)/chat/components/landing/chat-landing.tsx>), [landing-coworker-picker.client.tsx](<../web/src/app/(app)/chat/components/landing/landing-coworker-picker.client.tsx>), [chat-landing-notice.tsx](<../web/src/app/(app)/chat/components/chat-landing-notice.tsx>), [pending-room-message.ts](<../web/src/app/(app)/chat/utils/pending-room-message.ts>) |
| 29 | Create channel: name/slug availability, topic, discoverability, participants, step validation and errors. | 03, 06 | Todo | [create-channel-dialog.tsx](<../web/src/app/(app)/chat/components/create-channel-dialog.tsx>), [create-channel-wizard.ts](<../web/src/app/(app)/chat/components/create-channel-wizard.ts>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 30 | Browse discoverable channels, search/list/join and open joined room; respect workspace and visibility rules. | 07, 29 | Todo | [browse-channels-dialog.tsx](<../web/src/app/(app)/chat/components/browse-channels-dialog.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 31 | Room details/roster: members, coworker/bot/guest roles, profile details, topic, visibility, eligible controls and direct-message action. | 13, 27 | Todo | [room-roster-panel.tsx](<../web/src/app/(app)/chat/components/room-roster-panel.tsx>), [room-header-chrome.tsx](<../web/src/app/(app)/chat/components/room-header-chrome.tsx>), [chat-participant-hover-card.tsx](<../web/src/app/(app)/chat/components/chat-participant-hover-card.tsx>) |
| 32 | Edit channel name/topic/visibility and membership; permission/seat restrictions and errors remain server-authoritative. | 29, 31 | Todo | [edit-channel-dialog.tsx](<../web/src/app/(app)/chat/components/edit-channel-dialog.tsx>), [participant-checkboxes.tsx](<../web/src/app/(app)/chat/components/participant-checkboxes.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 33 | Leave/archive with confirmation; archived list, restore and delete with role/ownership restrictions. | 26, 32 | Todo | [edit-channel-dialog.tsx](<../web/src/app/(app)/chat/components/edit-channel-dialog.tsx>), [organization-chat-list.client.tsx](<../web/src/components/chat/organization-chat-list.client.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 34 | External chat invitations: pending inbox/sidebar, accept/decline, invite detail/deep link; guest-link join with sign-in/permission states. | 02, 07, 25 | Todo | [chat-room-invitation-card.tsx](<../web/src/app/(app)/chat/invites/[id]/components/chat-room-invitation-card.tsx>), [chat-join-card.tsx](<../web/src/app/(app)/chat/join/[token]/components/chat-join-card.tsx>), [organization-chat-list.client.tsx](<../web/src/components/chat/organization-chat-list.client.tsx>) |
| 35 | Manage room guest access: invite by email, list/revoke invitations, create guest links with expiry and max-uses options, show link usage/expiry, copy/revoke links, remove guest, role/visibility restrictions. | 31, 34 | Todo | [guest-invite-section.tsx](<../web/src/app/(app)/chat/components/guest-invite-section.tsx>), [room-roster-panel.tsx](<../web/src/app/(app)/chat/components/room-roster-panel.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 36 | Participant presence: online/away/offline dots, org presence publishing and lifecycle cleanup; no fabricated typing indicator. | 07, 31 | Todo | [live-member-presence-dot.tsx](<../web/src/components/chat/live-member-presence-dot.tsx>), [use-org-presence-map.ts](<../web/src/lib/ably/use-org-presence-map.ts>), [use-org-presence-publisher.ts](<../web/src/lib/ably/use-org-presence-publisher.ts>) |
| 37 | Coworker mention execution status: pending/thinking/reasoning, failed mention shell and retry; permission and availability feedback. | 07, 09a, 09b, 13 | Todo | [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [coworker-thought-ui.tsx](<../web/src/app/(app)/chat/components/coworker-thought-ui.tsx>), [rooms-client.tsx](<../web/src/app/(app)/chat/components/rooms-client.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 38 | Soko Bot chat: personal-assistant Direct and mentions, chain/status metadata, useful/not-useful feedback, task and pending-approval links opened on web. Assistant console itself is excluded. | 07, 13, 27 | Todo | [soko-bot-message-footer.tsx](<../web/src/app/(app)/chat/components/soko-bot-message-footer.tsx>), [soko-bot-chain-badge.tsx](<../web/src/app/(app)/chat/components/soko-bot-chain-badge.tsx>), [room-message-row.tsx](<../web/src/app/(app)/chat/components/room-message-row.tsx>), [actions.ts](<../web/src/app/(app)/chat/actions.ts>) |
| 39 | Minimal Settings: account identity/sign out, chat unread-count display preference, persisted server preference and rollback. | 01, 05 | Partial | [chat-display-preferences.tsx](<../web/src/app/(app)/account/components/chat-display-preferences.tsx>), [account-menu-config.tsx](<../web/src/app/(app)/components/sidebar/components/account-menu-config.tsx>) |
| 40 | Chat notifications while the app runs: chat delivery preferences (room message, mention, direct message) with persisted server state and rollback; receive chat-kind notification events on the user notifications channel; when the reader's preference includes OS banners and OS notification permission is granted, show a local notification while the app is running but unfocused (web's unfocused-tab rule: one banner per room carrying the waiting count); opening it attempts to mark the notification read and navigates to the target room/thread even if marking read fails; dismiss the room banner when an already-read event arrives, including reads from another device or the room itself, before applying display gates; respect room mute. No inbox and no closed-app push (see Out of scope). | 07, 25, 26, 39 | Todo | [notification-preferences.tsx](<../web/src/app/(app)/account/components/notification-preferences.tsx>), [notification-toast-listener.tsx](<../web/src/app/(app)/components/notification-toast-listener.tsx>), [use-notification-realtime.tsx](<../web/src/lib/ably/use-notification-realtime.tsx>), [use-room-notification-deep-link.ts](<../web/src/app/(app)/chat/hooks/use-room-notification-deep-link.ts>) |

Streaming was split into 09a (Directs) and 09b (reply threads) because Direct streaming can ship independently. Each child has its own status and PR; full streaming parity requires both to be Done.

## Existing Apple implementation and reuse points

| Owner | Existing behavior and remaining audit work |
| --- | --- |
| [CoreAPI](Packages/CoreAPI/Package.swift) | Generated Core client and HTTP transport. Reuse DTOs and generation; never hand-edit generated output. Compare the checked-in snapshot with current Core before each API-dependent slice. |
| [SokosumiAuth](Packages/SokosumiAuth/Package.swift), [AuthState](Packages/SokosumiAuth/Sources/SokosumiAuth/AuthState.swift), [KeychainTokenStore](Packages/SokosumiAuth/Sources/SokosumiAuth/KeychainTokenStore.swift) | OAuth/PKCE, bearer middleware, refresh, observable session state and Keychain persistence live in the existing package. [MacOAuthBrowser](Sokosumi/MacOAuthBrowser.swift) isolates AppKit presentation; [app composition](Sokosumi/AuthState+App.swift) wires configuration and the Core client. Slice 01 adds cancellation, late-response protection and shared refresh. Browser authentication remains the entry point, including existing sign-in methods and recovery. |
| [SokosumiChat](Packages/SokosumiChat/Package.swift), [WorkspaceState](Sokosumi/WorkspaceState.swift) | [WorkspaceSession](Packages/SokosumiChat/Sources/SokosumiChat/WorkspaceSession.swift) owns workspace access, identity, server restoration and selection. App `WorkspaceState` wires auth/realtime and retains room/transcript state for slices 03–08. Saved room selection and drafts are scoped by account/workspace. |
| [SokosumiRealtime](Packages/SokosumiRealtime/Package.swift) | Existing Ably dependency and transport seam cover focused-room deliveries and membership control. Reuse them; complete patch/recovery/thread/sidebar behavior against the web event contracts. |
| [ContentView](Sokosumi/ContentView.swift), [TranscriptView](Sokosumi/TranscriptView.swift) | Native split view, sidebar, avatars, text transcript, grouping, pagination and simple composer exist. Rich rendering, reply threads and interactive message actions remain incomplete. Avatar loading currently lives in a view file; networking belongs in a portable module. |
| [SokosumiApp](Sokosumi/SokosumiApp.swift), [SettingsView](Sokosumi/SettingsView.swift) | `WindowGroup`, Settings and Sign out command exist. App-level workspace state is shared across windows; independent per-window conversation selection is not established. |
| [App tests](SokosumiTests), package `Tests/` directories | Existing state, transport, auth, presentation and realtime tests are reusable. Extend the relevant suite for each slice and run all suites before claiming Done. |

All four shared packages declare macOS 26 and iOS 17. The app deployment target remains macOS 26. The user explicitly raised the shared macOS baseline to 26 after iteration 0; do not lower it to macOS 14. Verify shared-module iOS compatibility with an iOS 17 build rather than a macOS 14 build. Keep new Mac-only APIs isolated and audit existing view calls such as `onScrollGeometryChange`; do not move those calls into shared code. No dependency additions or dependency version changes are authorized by this inventory.

## Contract checkpoints

These are implementation checks, not findings that APIs are missing. If a required endpoint or behavior is unavailable/ambiguous, mark the affected row Blocked and ask; do not invent a replacement or silently drop the capability.

- Auth: reuse public-client OAuth/PKCE and existing Core workspace access gate. Native credential forms, signup and recovery screens are unnecessary; system-browser flows remain available.
- Classic chat: use Core's room/message/thread/membership endpoints through `CoreAPI`. Preserve role, guest, seat and workspace rules rather than inferring permissions from UI visibility.
- Streaming: web proxies existing Core `/chats/rooms/{id}/stream`, `/stream/active` and `/stream/messages` paths. Verify bearer authorization, the actual streamed event format and Swift snapshot coverage before rows 09a–09b. Web uses an AI SDK stream; existing Ably delivery alone does not implement it. Stop/regenerate controls are not exposed by the audited hook and are not assumed parity requirements.
- Attachments: Core mints a room-scoped upload session; file bytes go to the returned presigned Blob URL and the resulting URL becomes message markdown. This authorized upload destination is part of the existing contract, not a new backend. Do not send the Core bearer token to that URL.
- Drive picker, bot feedback and notification preferences: trace their existing Core endpoints and workspace/auth requirements before their respective slices. Native background push is not authorized by an in-app realtime implementation.
- Notifications: chat kinds arrive as the existing user-channel notification event, including the room-scoped banner count; read state uses the existing Core notification routes. Local notifications while the app is running need no push contract and do not authorize APNs.

## macOS-native additions

| ID | Capability | Depends on | Status |
| --- | --- | --- | --- |
| M1 | `NavigationSplitView`, native toolbar/sidebar commands, keyboard traversal, focus restoration, accessible labels and VoiceOver reading order. Respect system appearance, text sizing and reduced motion throughout every slice. | 03, 04 | Partial — split view exists; full keyboard/accessibility verification pending. |
| M2 | Commands for new conversation, find, compose focus, window/sidebar navigation; standard shortcuts and native context menus for message/room actions. Preserve text editing and IME shortcuts. | 06, 23, 27 | Partial — only explicit Sign out command found. |
| M3 | Settings scene with account identity, sign out and chat preferences; standard Settings shortcut and native presentation. | 39 | Partial — basic scene exists. |
| M4 | Multiple windows with independent selected conversations and drafts, shared authenticated session and consistent cross-window updates; opening links routes to the right room. | 11, 25 | Partial — WindowGroup exists, independent state is not established. |
| M5 | Native file importer/drop handling, preview/open/save actions and permission/error feedback through SwiftUI or isolated platform adapters. | 14, 15 | Todo. |

These additions belong in the related feature PR where cohesive; otherwise give the addition its own PR. They are required completion work, not decorative web layout parity.

## Out of scope

| Excluded web feature | Boundary / representative source |
| --- | --- |
| Billing, plans, credits, payment methods, invoices and subscriptions | No native commerce screens. Existing permission/insufficient-credit errors in chat must still be explained. [Billing](<../web/src/app/(app)/billing>) |
| Administration, organization creation/settings, seat management and vendor/coworker access administration | Chat uses existing workspace access; access management stays on web. [Workspace gate](<../web/src/app/(app)/components/workspace-access-gate.tsx>), [account coworker access](<../web/src/app/(app)/account/components/account-coworker-access.tsx>) |
| Marketing, agent marketplace/catalog, hiring, agent configuration and ratings | Only chat recipient selection is included. Links to discovery destinations can open web. [Chat discovery CTA](<../web/src/app/(app)/chat/components/landing/search-agents-strip-action.client.tsx>), [agents components](<../web/src/components/agents>) |
| Identity onboarding, signup, organization invitations unrelated to chat and workspace setup wizards | Browser handoff for required setup; chat room invitations are explicitly included in rows 34–35. [Setup](<../web/src/app/(flows)/setup>), [signup](<../web/src/app/(auth)/signup>) |
| Tasks, jobs, calendar, coworker workflows, personal-assistant console configuration/approvals/memory/schedules and the chat landing's task statistics strip | Render chat references and open linked web destinations. Do not build these product screens or the statistics strip. [Tasks](<../web/src/app/(app)/tasks>), [calendar](<../web/src/app/(app)/calendar>), [personal assistant](<../web/src/app/(app)/personal-assistant>), [landing stats](<../web/src/app/(app)/chat/components/landing/chat-landing.tsx>) |
| Standalone Drive/file management and connection/provider setup | Only the existing chat attachment picker is included (row 16). Provider setup can open web. [Drive picker](<../web/src/components/drive/drive-file-picker.tsx>), [connections](<../web/src/app/(app)/connections>) |
| Full account/profile/security management, branding and destructive account/workspace deletion | Identity, session and chat settings only. Browser sign-in preserves existing auth methods; no native password/passkey management. [Account components](<../web/src/app/(app)/account/components>) |
| Closed-app push: APNs registration, background delivery and banners while the app is not running | Require separate explicit scope/contract approval under existing [Apple vision](VISION.md) and [ADR 0023](../../docs/adr/0023-web-owns-push-rendering.md). Local notifications while the app is running but unfocused, chat preferences and banner navigation stay in row 40. [Web push activation](<../web/src/lib/ably/push-activation.client.ts>) |
| Notification center: header bell/dropdown, the notifications inbox with mark-all-read, clear-all and delete, and non-chat notification kinds (jobs, tasks, vendor and coworker access) | Web delivers in-app chat notifications through this cross-product inbox; the native app carries chat attention through sidebar unread/mention state (05, 26) and row 40 banners instead. Add a chat-only list only if reviewers ask. [Notification bell](<../web/src/app/(app)/components/header/header-notification-bell.client.tsx>), [notifications page](<../web/src/app/(app)/notifications/page-content.tsx>) |
| iOS app target/release, Android, Windows and Linux native clients | iOS portability is required now; iOS UI and release work are later. |

### Web-only concerns — N/A

| Concern | Status | Native treatment / web evidence |
| --- | --- | --- |
| SEO, metadata, indexing and server rendering/hydration | N/A | No native equivalent. [Chat layout](<../web/src/app/(app)/chat/layout.tsx>), [chat page](<../web/src/app/(app)/chat/page.tsx>) |
| Cookie banner and browser session-cookie plumbing | N/A | System-browser OAuth and Keychain replace browser cookie storage. [Sign-in](<../web/src/app/(auth)/signin/page.tsx>) |
| Responsive breakpoints, mobile bottom tabs, CSS hover gutters and browser safe-area layout | N/A | Native split view, resizing and commands; retain capabilities and accessibility. [Mobile nav](<../web/src/app/(app)/chat/components/chat-mobile-bottom-nav.tsx>), [room shell](<../web/src/app/(app)/chat/components/room-shell-layout.tsx>) |
| Browser document-title unread badge, DOM scroll anchors, URL query-state implementation, service worker/Web Push machinery | N/A | Preserve unread attention and message navigation behavior through native state; browser infrastructure itself is not ported. [Unread title](<../web/src/hooks/use-chat-unread-document-title.ts>), [message jumps](<../web/src/app/(app)/chat/hooks/use-room-message-jumps.ts>), [push activation](<../web/src/lib/ably/push-activation.client.ts>) |
| GTM/browser marketing analytics | N/A | No tracking implementation implied by chat parity. [Streaming hook](<../web/src/app/(app)/chat/hooks/use-coworker-direct-room-stream.ts>) |

## Verification and approval record

Iteration 0 changed only this Markdown file. Its source links, dependency order and diff boundary were validated; it did not claim Swift build/test results.

For every implementation PR, run from `apps/apple/`:

```sh
mint run swiftformat --lint .
mint run swiftlint lint --strict
xcodebuild -project Sokosumi.xcodeproj -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- build
xcodebuild -project Sokosumi.xcodeproj -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- \
  test -only-testing:SokosumiTests -enableCodeCoverage NO
swift test --package-path Packages/CoreAPI
swift test --package-path Packages/SokosumiAuth
swift test --package-path Packages/SokosumiChat
swift test --package-path Packages/SokosumiRealtime
```

Coverage is disabled for app tests to match Apple CI: the existing Ably C dependencies fail to link the profile runtime with coverage enabled.

Add feature tests at the existing transport/state boundary, including failures and stale workspace/session results. Verify the affected behavior against web, exercise native UI and inspect SwiftUI runtime warnings. Shared-module changes also need an iOS 17 availability check; merely building the macOS 26 app is insufficient. Record concrete commands/results and manual evidence in the feature PR. The documentation-only iteration 0 required no new tests; each implementation slice requires feature coverage.

- Iteration 0 approval: **merged**, [PR #4303](https://github.com/masumi-network/sokosumi/pull/4303).
- Completed feature: **01 — portable authenticated session lifecycle**, merged in [PR #4304](https://github.com/masumi-network/sokosumi/pull/4304) on 2026-09-09; all Apple CI checks passed. See verification below.
- Completed feature: **02 — workspace access and selection**, merged in [#4309](https://github.com/masumi-network/sokosumi/pull/4309). Core prerequisite #4306 also merged.
- Completed feature: **03 — conversation sidebar**, merged in [#4312](https://github.com/masumi-network/sokosumi/pull/4312).
- Completed feature: **04 — room timeline**, merged in [#4313](https://github.com/masumi-network/sokosumi/pull/4313); native scrolling accepted by the user.
- Completed feature: **05 — read/attention state**, merged [#4322](https://github.com/masumi-network/sokosumi/pull/4322). Visibility-gated reads, content snapshots, optimistic attention rollback, manual unread, and stale refresh isolation are implemented; local tests and portability checks pass. Thread look writes remain in slice 08; row 26 retains pin/mute actions.

### Slice 01 verification — portable authenticated session lifecycle

- Ownership: `SokosumiAuth` owns observable auth state and Keychain persistence. The app retains configuration/Core wiring and the `#if os(macOS)` system-browser adapter. Existing Keychain service/account, OAuth scopes, callback URI and ephemeral browser behavior are preserved.
- Lifecycle: explicit cancel, visible browser/network/persistence failures, restoration, durable sign-out, late-response invalidation and one refresh for concurrent requests. Regression tests first reproduced token resurrection after sign-out, then passed with the fix.
- Local verification: Xcode 26.6. Auth package: 34 tests; CoreAPI: 1; chat: 80; realtime: 8; app target: 36. SwiftFormat and strict SwiftLint passed. Xcode build and app tests passed with code coverage disabled as in CI.
- iOS portability: `swift build --package-path Packages/SokosumiAuth --triple arm64-apple-ios17.0 --sdk "$(xcrun --sdk iphoneos --show-sdk-path)" --scratch-path /tmp/sokosumi-auth-ios17` passed. Both app and package baselines are macOS 26; no macOS 14 deployment support is required.
- Native smoke check: the built app restored the existing Keychain session and loaded workspace/room history. The system-browser success/cancel/failure transitions are covered through an injected browser in package tests; a fresh interactive login was not performed on the user's active account.
- Runtime inspection: the test host logged a QoS priority-inversion diagnostic; no view-update publication warning was observed in the inspected run. Generated Core schema warnings remain outside this auth slice.
- Out of scope for this PR: workspace state extraction (02), remaining chat features, dependencies and API changes. Row 01 is Done after merge and passing Apple CI.

### Slice 02 contract checkpoint — workspace restoration

Rebased on `main` at `acbb46153` after #4304 merged. [Core prerequisite PR #4306](https://github.com/masumi-network/sokosumi/pull/4306) adds the approved read endpoint; merged on 2026-09-09 before this Apple slice began.

- Web creates sessions using [resolveActiveOrganizationIdForSession](../../apps/core/src/services/preferred-organization.service.ts): valid server preference, otherwise personal workspace, otherwise first organization.
- Core exposes [PUT preferred organization](../core/src/routes/v1/users/[id]/preferred-organization/put.ts), and this PR adds the matching [GET](../core/src/routes/v1/users/[id]/preferred-organization/get.ts) to [the user routes](../core/src/routes/v1/users/[id]/index.ts). [User](../core/src/schemas/user.schema.ts) and workspace-access responses do not expose the preference.
- The obsolete local workspace preference store has been removed. Apple now reads the server selection, including changes made on another client or a fresh installation.
- User approved a separate Core API PR on 2026-09-09 to expose the resolved selection. Implement `GET /users/{id}/preferred-organization` using the existing sign-in resolver; preserve the workspace-access gate and make no preference writes. That prerequisite is merged; this slice consumes it.

Core prerequisite verification (2026-09-09): `pnpm --filter core test` passed (492 test files, 5,164 tests; 3 files / 11 tests skipped). `pnpm exec turbo run typecheck --filter=@sokosumi/core`, `pnpm exec turbo run build --filter=@sokosumi/core`, and Biome checks on changed TypeScript files passed. Route tests cover self/admin access, rejection of another user and agent access, missing users, resolution failure, and the OpenAPI response. Existing resolver tests cover valid/stale preferences and personal/organization fallbacks; added the no-workspace case. No Swift source changed, so Apple builds are recorded under slice 01 rather than rerun for this Core prerequisite. The web client was not regenerated because the explicit instruction forbids changes under `apps/web`; the additive endpoint will be consumed by Apple in slice 02.

### Slice 02 verification — workspace access and selection

- Rebased on main `7d4a1f269`. Shared `WorkspaceSession` owns gate, identity, options, restoration and switch state. The app keeps auth/realtime composition and the existing room/transcript facade; no new dependencies.
- Restoration performs only GETs, including the resolved preference from #4306. Changed membership between reads fails with retry rather than inventing a personal workspace. Organization members are not filtered by seats. Setup gates stop before room loading and offer an Open setup link plus Check again.
- Successful switches clear the old transcript/subscription before retargeting; failed switches keep the previous workspace and restore its preference using the existing service behavior. Account reset invalidates late loads, switches, token mints and outbound errors. Reset/caller cancellation stops late switch rollback writes.
- Room selection is persisted per account and workspace. Existing draft storage and composer identity already isolate account/workspace/room; those are retained. Rich draft features remain row 11.
- CoreAPI input regenerated from the current Core router document into a temporary file, then extracted to existing Apple operations plus the new GET and transitively referenced components. No web files were changed.
- Native smoke check: the built app restored the existing account, displayed its organization workspace and loaded the room list. No messages were sent and no private chat screenshot was published. Setup and switching failure paths are covered with fake transport tests.
- Runtime inspection: existing test-host QoS priority-inversion diagnostics appeared; no view-update publication warning was observed.
- Final verification: Xcode 26.6 build and all 36 app tests passed with the commands above. Package suites passed: CoreAPI 1, auth 34, chat 85, realtime 8 (164 tests total). SwiftFormat lint and strict SwiftLint passed. `swift build --package-path Packages/SokosumiChat --triple arm64-apple-ios17.0 --sdk "$(xcrun --sdk iphoneos --show-sdk-path)" --scratch-path /tmp/sokosumi-chat-ios17` passed. Extracted OpenAPI operations/components were compared with the generated Core document and matched exactly. Reviewer cancellation finding fixed and re-reviewed with no remaining findings.

### Slice 03 verification — conversation sidebar

- Started from main `7f1d9c020` after #4309 merged. `ConversationSidebar` owns room list, selection restoration/persistence, disclosure state and refresh lifecycle in `SokosumiChat`. `WorkspaceState` retains authentication/realtime/transcript composition. Avatar networking and thumbnail decoding also moved into the portable package.
- Reused existing `SidebarRooms` helpers after comparison with web: membership grouping, guest fallback, participant names/avatar order, self-only fallback, three-face limit, pinned/muted/private/activity sorting and stable IDs. Native sections follow Channels / External / Directs; Channels are organization-only. Private channels use a lock; guest rows show host organization. Sections collapse independently without discarding selection.
- Existing Core list pagination and workspace headers remain. Repeated cursors stop before appending a duplicate page, matching web. Refresh preserves the open transcript; errors retain the prior list and expose Retry. Workspace transitions/reset invalidate late refresh results.
- Feature coverage: selection persistence and fallback display order, account isolation, disclosure reset, late refresh invalidation, failed refresh/retry, app transcript preservation, and repeated-cursor pagination. Existing transport tests cover multiple pages and sidebar tests cover grouping/names/avatars/sorting.
- Native smoke check: Apple Development signed build restored the existing session and displayed Channels / External / Directs with disclosure controls, avatars and Refresh conversations. No private chat screenshot was uploaded. No messages were sent. Setup/empty/error paths use transport tests rather than modifying the active account.
- Runtime inspection: existing test-host QoS priority-inversion diagnostics remain; no view-update publication warning observed. Existing Core schema/AppIntents warnings remain.
- Final verification: Xcode build and 39 app tests passed; chat 92, auth 34, CoreAPI 1, realtime 8 tests passed (174 total). SwiftFormat lint and strict SwiftLint passed. Shared iOS 17 compilation passed using the command recorded under slice 02. Interactive build/test used the same Xcode commands above with `-derivedDataPath /tmp/sokosumi-interactive-signing DEVELOPMENT_TEAM=Y3ZJFLUYRB CODE_SIGN_IDENTITY='Apple Development'`. Read-only reviewer found no regressions, including the avatar extraction and pagination fix.
- Out of scope: timeline changes (04), attention correctness (05), live membership/recovery (07), presence, pin/mute actions, invitations, archived browsing and room creation remain their numbered slices. No web files, API contracts or dependencies changed.

### Slice 04 verification — room timeline

- Started from main `0ce3119d7` after #4312 merged. Reuses `ChatService.listMessages`, `mergeRealtimePage`, `MessagePresentation`, and the shared avatar loader. `RoomTimeline` now owns history state, cursor, lifecycle generation and page merging in `SokosumiChat`; the app composes auth, read marking, outbound and realtime work around it.
- Initial/older/latest pages merge by ID and chronological order. Older-page overlaps do not duplicate rows; a repeated cursor ends pagination. Failed pages retain resolved history and the retry cursor. Late pages cannot populate a different room, including same-room reopen after reset. Reset clears older-page loading state.
- Existing sender grouping, local day boundaries, membership rows and deleted/edited labels remain. All sender types now use their available avatar images through the shared loader.
- Mac-specific timeline views are guarded with `#if os(macOS)`. Native scroll-position IDs retain the reading anchor when history is prepended; reader intent follows latest only near the bottom or after the Latest messages action. The near-bottom threshold matches web (200). Automatic older loading requires actual user scrolling and available pages; window resize does not unpin latest. Inline retry targets the failed page rather than always trying older history.
- New transport/state coverage includes overlapping pages, repeated cursors, failed older-page retry, stale room responses and follow-latest intent. Existing presentation tests cover grouping, membership and local date labels; app tests cover initial/older errors, room switching and live/history interactions.
- Automated verification: Xcode build and 41 app tests passed; chat 101, auth 34, CoreAPI 1, realtime 8 passed (185 tests total). Shared iOS 17 compilation and SwiftFormat/strict SwiftLint passed. Review build/tests used macOS arm64, `/tmp/sokosumi-review-tests`, `DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=-` and `-enableCodeCoverage NO`; iOS compilation used the slice 02 command. Independent review caught a resize/unpin issue; fixed, covered and re-reviewed without remaining findings.
- **Native verification accepted by the user:** the user confirmed scrolling up/down and Latest messages returning to the bottom, then explicitly accepted native scrolling as working. Production GET and signed-app workspace restoration were verified. The agent did not independently complete every native scenario; keep the existing scroll implementation per review and user direction.
- Out of scope: read/attention behavior changes (05), composing (06), realtime recovery (07), reply threads (08), and rich text/attachments. No web changes, shared API changes or dependencies.

- Slice 04 review follow-up: `RoomTimeline.loadPage` now owns loading flags, errors and single-flight admission, with generation-safe cleanup. Room ID, cursor, pagination and loading flags are read-only externally. Tests cover flags, overlapping requests, cancellation and latest-page pagination preservation. App composition tracks queued tasks to preserve realtime refreshes behind older loads; tests await actual task completion, including read marking. Existing scroll code retained as requested.

### Slice 05 verification — read and attention state

- Portable `RoomReadAttention` owns content snapshots, optimistic counters, failure rollback, pending expiry, and refresh revisions. Native scene visibility gates reads; successful history refreshes resynchronize even when content is unchanged after a failed attempt.
- Active and muted rooms suppress unread chrome. The sidebar offers Mark unread for inactive, unmuted rooms through the existing Core endpoint. Core's residual thread counts are retained; thread look writes remain in slice 08.
- The Apple Development signed macOS build passed. Native smoke check: the signed app restored its session; Mark unread was enabled and invoked for an inactive room, and disabled after selecting that room. The original conversation was restored afterward. Runtime logs showed AppKit negative-geometry diagnostics during interaction; their source is not yet established.
- Local verification: 110 chat, 34 auth, 1 CoreAPI, 8 realtime, and 42 app tests passed. Strict SwiftLint passed with zero violations; SwiftFormat passed. The shared chat package builds for `arm64-apple-ios17.0`.
- New coverage includes hidden/unresolved history, same-ID content changes, read failure/retry, manual unread failure/rollback, stale refreshes and settlements, workspace reset, pending expiry, active/muted attention, and a successful refresh retry with unchanged visible content.
- Independent review found a missed refresh-retry read; fixed with app integration coverage. Follow-up review found no remaining actionable issues.
- No Core contract, web source, or dependency changes. The Apple snapshot adds the already-deployed unread operation through a reproducible extraction script.

### Slice 06 verification — compose and send

- Started from main at `69765bb5f` after #4322 and avatar bugfix #4323 merged.
- Reuse `OutboundShell`, reconciliation helpers, `ChatService.createMessage`, and `SavedComposeDraft`. Replace the obsolete single-flight slot with a portable `RoomOutbox` that queues sends while leaving the composer available.
- Match the web's 30-second timeout, stable retry IDs, stale completion isolation, silent workspace teardown, 10,000 UTF-16-unit limit, and counter from 9,500 units.
- A macOS-only AppKit input adapter is isolated behind `ComposerInput`: native testing showed SwiftUI submission also fires on marked-text commit. The adapter preserves marked-text handling, inserts newlines for Shift/Command/Control-Enter, and clears immediately only after an accepted send. Native harness verified marked-text Return does not submit; the following Return does. Control-Return requires intercepting AppKit's contextual-menu shortcut.
- Verification: Xcode build and app test suite passed, including successful/rejected submission and modified-Return selection replacement. Shared suites passed: chat 118, auth 34, CoreAPI 1, realtime 8. Strict SwiftLint: zero violations; SwiftFormat passed. Shared chat builds for iOS 17; Apple Development signed app build passed.
- Native verification used an isolated harness containing the actual input views, without sending production messages: Shift/Command/Control-Return insert newlines; plain Return sends and clears immediately; dead-key marked-text commit does not send. Full language-specific IME coverage remains a manual QA check.
- Independent code review and follow-up keyboard review found no remaining actionable issues.
- Out of scope: reply threads, rich formatting, mentions, attachments, coworker streaming, and durable outbox persistence. No web, shared API contract, or dependency changes. The periodic automation was deleted by user request.

- Slice 06 composer geometry follow-up: measurement now uses separate text storage and finite widths, without mutating the live editor during SwiftUI sizing probes. Actual layout uses the clip view bounds, preserves long-draft scroll position, and includes the trailing blank line. New regression tests cover zero/infinite proposals, unchanged editor frames during measurement, the empty editor hit area, trailing newlines, and scroll preservation. Full app tests, lint/format, and the signed build passed; direct pointer click and typing passed in the horizontal native harness. Separate negative-size diagnostics also reproduced with a plain SwiftUI TextField baseline; the reported infinite/oversized-width path is removed.

- Slice 06 review follow-up: timeout and room switch no longer cancel the in-flight POST (web releases the local queue only; Core may already have the row). Isolation stays on the attempt token. Failed timeout shells show the timeout copy instead of a generic connectivity error. Tests cover uncancelled sends, the timeout copy, and leftover POST stubs after a room switch. Remaining nits: no composer placeholder, no pending/sent chrome, `ChatService()` minted per send.

- Slice 06 review nits addressed: native placeholder uses the selected room's display name and stays hidden during marked-text composition; queued/in-flight rows show Sending after the web's 500 ms delay, and slow confirmations show Sent for 1.6 seconds, including continuation rows and either HTTP/Ably confirmation order. Fast sends skip delivery flashes. The send closure captures the existing stateless service. New tests cover fast/slow confirmation, sent expiry, realtime-before-HTTP deduplication, and reset cleanup. Chat 121 tests, full app tests, iOS 17 compilation, strict lint/format, and signed build passed; native harness verified visible placeholder and sending/sent indicators plus typing/marked-text behavior.


### Slice 07 implementation and verification

- Baseline main `a3b337626`, branch `codex/apple-live-room-updates`; [PR #4327](https://github.com/masumi-network/sokosumi/pull/4327). Slice 06 is merged. Web polling migration #4310 is included in this slice's behavior.
- Reused `RealtimeConnection`/`AblyRealtimeConnection`, `ResolvedRealtimeDelivery`, `RealtimeTranscript`, `RoomTimeline`, `ConversationSidebar`, and `WorkspaceSession`. One socket, one live Core token provider; no prepared-token or parallel app remint path. No web, shared API contract, or registry dependency changes.
- Full DTO and ID-envelope hydration preserve merge/tombstone/own-send behavior. Reaction, unfurl (including null), and mention-status patches update only existing matching top-level messages. Viewer reaction flags derive from reactor IDs, matching `personalize-chat-room-message-event.ts`. Pin events update shared pin overrides and sidebar counts; management UI remains row 21.
- Room recovery runs every 60 seconds while healthy, 3 seconds otherwise; sidebar recovery uses 60/15 seconds. Hidden or unfocused windows defer reads. In-flight requests coalesce into one follow-up and timers re-arm after completion. Generations isolate room/workspace/account changes. Initial native list loads satisfy mount refresh without duplicate GETs.
- SDK channel/connection health detects continuity loss, reattachment, suspension/failure, and reconnection. First connection/attachment is not a gap. Selected-room listeners are separate from membership subscriptions and removed on room change/disconnect.
- Membership channels intersect props with explicit token subscribe capabilities. Local revocations detach immediately; authorization coalesces and retries after 15 seconds or connection recovery. Subscription IDs reject old attachment callbacks. Scope changes invalidate old token mints and authorization results. Foreground return refreshes membership.
- Revocations invalidate pending sidebar responses. The shared workspace model filters destination rooms revoked while a workspace-switch response is pending. Held-response app tests cover both races. Independent follow-up review found no remaining actionable findings after these fixes.
- Verified so far: 27 realtime tests (`/tmp/slice07-realtime26.log`); Xcode build/app tests including destination-switch revocation (`/tmp/slice07-app27.log`); shared chat iOS 17 compile (`/tmp/slice07-ios27.log`). The full chat run exposed an existing Sent-expiry test's 100 ms scheduling tolerance; it now observes expiry within a bounded deadline. The rerun passed all 128 chat tests (`/tmp/slice07-chat28.log`); auth 34 and CoreAPI 1 also passed (`/tmp/slice07-auth28.log`, `/tmp/slice07-core28.log`). The Apple Development signed build passed (`/tmp/slice07-signed28.log`). Strict lint passed (`/tmp/slice07-lint29.log`).
- Remaining gates: CI/human review and merge of PR #4327. Do not start slice 08 before merge. Latest full Xcode build/app tests passed, including continuity-loss/foreground integration (`/tmp/slice07-app29.log`); final format and diff checks passed. Reply threads, reaction/pin management UI, rich rendering and coworker streaming retain their later rows. Do not mark this slice Done before its PR is verified and merged.

- CI follow-up: `changingRoomDropsPendingOutbound` now waits for the paused transport POST to complete before asserting all response stubs were consumed. Room switching intentionally clears the outbox busy flag before that uncancelled request settles, so waiting on the outbox alone was racy. Production behavior is unchanged.

### Slice 08 — reply threads

Draft [PR #4340](https://github.com/masumi-network/sokosumi/pull/4340), branch `codex/apple-reply-threads`, rebased on `9c1157a6f`. Await human review/merge before starting slice 09a.

Implementation:

- Reuse `RoomTimeline`, `RoomOutbox`, `RoomReadAttention`, and the native composer. `ThreadSession` owns the separate parent, paginated reply history, outbound queue, and recovery lifecycle; thread draft keys include parent identity.
- Native detail navigation opens a thread with parent preview, reply count, loading/error/retry states, and independent composer. Reuse message/day/membership rendering. Back/close and room/workspace/account changes invalidate thread work.
- User-requested upper-right hover Reply action replaces the repeated zero-reply link. Keyboard focus, context-menu, and accessibility actions remain available; positive reply counts stay below messages as thread links.
- Existing Core reply-list/read operations are selected through `scripts/update-core-api.py`; sends use the existing message POST with `parentMessageId`. No dependencies, Core contract changes, or web edits. Removed unused thread-root lookup introduced during the audit.
- Initial loading performs thread look, non-optimistic room read, then reply GET. Automatic visible attention includes parent identity and replies, looks before room read, deduplicates unchanged content, and retries failures. Navigation rejects stale completions.
- Full messages, patches, and envelopes route independently to room, parent, and replies. Hard-deleting the parent closes its thread; soft deletion keeps its preview. Recovery initializes pagination after failed initial loading. Accepted own replies restore bottom following; content/viewport growth stays pinned while following. The user's PR #4339 room-bottom fix is preserved, with the same padding convention in threads.

Web sources checked: `components/rooms-client.tsx` (`loadThreadMessages`, `handleLoadOlderThreadMessages`, `refreshFocusedRoomMessages`, realtime routing), `hooks/use-room-read-attention.ts`, `utils/room-read-attention.ts`, `components/thread-panel.tsx`, and `utils/chat-room-message-scope.ts`, under `apps/web/src/app/(app)/chat/`.

Verification:

- Final ad-hoc `xcodebuild build test -only-testing:SokosumiTests` passed (`/tmp/slice08-final-app.log`). New app coverage verifies initial read ordering, independent room/reply data, and pagination recovery.
- Chat 149 tests in 16 suites passed (`/tmp/slice08-final-chat.log`); Auth 34, Realtime 27, CoreAPI 1 passed (`/tmp/slice08-{auth,realtime,core}24.log`). Tests cover scoped history/drafts, send retries, routing/deletion, stale loads, and read-order/navigation races.
- Shared iOS 17 build passed after generated-snapshot cleanup (`/tmp/slice08-ios26.log`). SwiftFormat required no changes; strict SwiftLint found zero violations (`/tmp/slice08-final-{format,lint}.log`).
- Signed Apple Development build including the hover/accessibility controls passed (`/tmp/slice08-signed28.log`); final scroll changes are covered by the final ad-hoc Xcode build.
- Independent review findings for recovery pagination and thread bottom-following were fixed; re-review found no further must-fix issues.
- Native proof: open parent/empty thread, type in composer, navigate back, reopen with restored draft; room draft remains separate. Verification draft cleared without sending. No production messages posted. Manual hover appearance and long-thread scrolling are requested in the draft PR: CUA pointer operations intermittently failed with `noWindowsAvailable`/`elementHasNoFrame`; these are inconclusive automation observations, not diagnosed app defects.

Known parity limitation: parent ID envelopes hydrate from the latest room page, matching current web. A parent outside that page may remain stale until revisited or receiving a full DTO. Existing thread lookup is not a general root-message lookup (zero-reply roots can be absent), so it is not silently substituted.

Coworker streaming (09a), rich rendering, attachment/reaction/pin UI, and thread overview (24) remain later slices. Poll PR state and reviews; address review feedback before the next slice. Do not recreate the deleted automation.

### Slice 08 hover flicker follow-up (2026-09-10)

- User recording shows flicker while hovering message actions. Hover tracking now surrounds the row and its Reply overlay, using continuous tracking with state writes only on entry/exit. This addresses the suspected tracking-region feedback without changing message layout.
- Signed Apple Development build, app-target tests, SwiftLint and SwiftFormat passed (`/tmp/hover-flicker-build.log`, `/tmp/hover-flicker-tests.log`, `/tmp/hover-flicker-lint.log`, `/tmp/hover-flicker-format.log`). Updated signed app relaunched.
- Visual resolution remains unconfirmed: CUA pointer placement returned `noWindowsAvailable`; retest row-to-toolbar movement and resting over Reply manually.

### Slice 08 Reply hover highlight (2026-09-10)

- The user confirmed hover behavior is much better and requested a separate Reply highlight. The CTA now uses a semantic rounded hover fill across its padded click area. Continuous hover tracking and stable layout remain in place.
- Signed Apple Development build and SwiftLint passed (`/tmp/reply-highlight-build.log`, `/tmp/reply-highlight-lint.log`); SwiftFormat and diff checks passed. Pointer appearance still needs native visual confirmation; no new model or networking behavior was introduced.

### Slice 08 full-width message hover (2026-09-10)

- Moved the room transcript horizontal inset into message content. Hover backgrounds and tracking now span the chat pane; avatars, text and Reply retain their 12pt inset. Reply-count alignment and error/status insets are preserved.
- Signed Apple Development build, SwiftLint, SwiftFormat and diff checks passed (`/tmp/full-width-hover-build.log`, `/tmp/full-width-hover-lint.log`). Native pointer verification remains manual.

### Slice 08 consistent message spacing (2026-09-10)

- Every message now has 4pt vertical padding inside its full-width hover background. The 8pt sender-group gap sits outside that background. Continuation rows retain the avatar column width without imposing an avatar-height minimum.
- Reply counts now live in the message text column and inside the same hover region. The Reply toolbar uses compact vertical padding to fit continuation rows.
- Signed Apple Development build, SwiftLint, SwiftFormat and diff checks passed (`/tmp/message-spacing-build.log`, `/tmp/message-spacing-lint.log`). Native hover appearance remains a manual verification step.

### Slice 08 Reply boundary alignment (2026-09-10)

- Centered Reply vertically on the message highlight top edge using its measured alignment guide, so half sits above the highlight. Uses a compact caption label with a larger outlined text-bubble SF Symbol to follow the supplied Slack reference. Hovering the raised CTA keeps its message highlight and action visible.
- Signed Apple Development build, SwiftLint, SwiftFormat and diff checks passed (`/tmp/reply-boundary-build.log`, `/tmp/reply-boundary-lint.log`). Native pointer and visual confirmation remain manual.

### Slice 08 Reply offset correction (2026-09-10)

- User screenshots showed the alignment-guide implementation left Reply inside the highlight. Replaced it with an explicit upward offset of half the button height; the height scales with the body text size.
- Removed sidebar hover suppression at the user’s request. Sidebar and message hover states remain independent.
- Signed Apple Development build, SwiftLint, SwiftFormat and diff checks passed (`/tmp/reply-offset-final-build.log`, `/tmp/reply-offset-final-lint.log`). Native visual confirmation remains manual.

### Slice 08 review fixes (2026-09-10)

- `RoomOutbox` now reports HTTP success even when a realtime echo already removed the shell, matching web's `drainClassicOutboundQueue`. Previously the own-reply thread count and room reply link stayed stale whenever the echo beat the 201. A send that times out and is confirmed only by its echo still does not count, same as web.
- Reply counts use Foundation inflection (`1 reply`, `2 replies`).
- Chat 150 tests in 16 suites passed, including a new echo-first thread regression that failed before the fix. `xcodebuild test -only-testing:SokosumiTests -enableCodeCoverage NO` passed. SwiftFormat required no changes; strict SwiftLint found zero violations.

### Slice 08 review findings 1–5 (2026-09-10)

- Deleted-message rows retain existing reply-count links but no longer offer hover, context-menu or accessibility Reply actions.
- Parent envelopes request one room refresh. Thread-specific envelopes still refresh the parent preview when the room resolver ignores them.
- Room and thread sends share the participant builder, including the empty-name email fallback. Missing thread clients settle initial loading with a retryable configuration error.
- Room and thread attention use the same resolved-history gate, allowing failed older-page loads while excluding failed initial/latest loads. The separate product question about reading hidden room messages is unchanged.
- Verification: Xcode app-target tests passed (`/tmp/review1-5-app3.log`), including parent-envelope refresh counts, sender name fallback, missing-client loading and all four initial-thread/older-room failure combinations. SwiftLint, SwiftFormat and diff checks passed. The shared package was unchanged; its 150 tests passed immediately before these app-only fixes.

## Slice 09a audit checkpoint

- Web POST `/api/chat` proxies Core POST `/chats/rooms/{id}/stream`; GET `/api/chat?roomId=…` proxies `/stream/messages`; GET `/api/chat/{roomId}/stream` proxies `/stream/active` and preserves 204 for no active stream.
- Core routes already exist in `apps/core/src/routes/v1/chats/rooms/[id]/stream/{post,get,stream-get}.ts`. Next audit must verify bearer coverage and the complete streamed event format; no contract or dependency changes are authorized.
- Reuse candidates: `RoomTimeline` for persisted history, existing composer for drafts/input, CoreAPI client with bearer/org middleware for requests, and `SokosumiChat` for portable streaming state. Ably alone does not supply incremental AI SDK stream content.

### Slice 09a verified behavior and implementation seams

- Eligibility: one human and one coworker in a Direct, no Soko Bot; Core also verifies the human is the authenticated user and enforces write access. `room-helpers.ts` and Core stream POST own these rules.
- Send body: web clears earlier transient turns and sends one user UI message (`id`, `role`, text `parts`) in `messages`, plus room `id`/`roomId`. Core loads context and locks before persistence; concurrent turns return 409, a failed configured lock returns 503. Keep one client send lock for submitted/streaming states; do not use the classic retry queue for these POSTs.
- Resume: the hook reconnects on each room entry; 204 means idle with no thinking flash. An active 200 stream with no messages gets a stable empty coworker shell. Overlay creation times stay stable across chunks. Room/workspace switches must invalidate old tasks.
- Events: Core uses `toUIMessageStreamResponse`. Text and reasoning arrive as JSON start/delta/end events with block IDs, plus message start/finish/error and `[DONE]`. Primary protocol reference: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol. Use the installed OpenAPIRuntime `asDecodedServerSentEvents` implementation, not a new framing parser/dependency.
- Reconciliation: web skips full realtime message merges during submitted/streaming; on finish it refreshes persisted history and only clears overlays on successful merge. Failed refresh retains overlays. `merge-room-messages.ts` hides the latest persisted user match once per overlay occurrence, so repeated identical historical messages survive.
- Thinking/reasoning: `coworker-thought.ts` shows the latest reasoning block before answer text, then exposes combined reasoning as a disclosure; durable timing comes from `metadata.thought_timing_ms`. Keep this presentation distinct from rich message rendering in later slices.
- Next implementation: select existing stream POST/resume operations in the generated snapshot; add a portable event accumulator and stream session using the existing client/SSE decoder, then wire Direct eligibility, composer lock, overlays, thought UI and settlement to WorkspaceState. Test fragmented SSE through the runtime, ordered text/reasoning blocks, errors, 204, cancelled room switches, duplicate reconciliation and failed settlement before PR.

### Slice 09a networking checkpoint (2026-09-10)

- Regenerated the Apple snapshot from deployed Core (`/tmp/slice09-core-openapi.json`) with POST `/chats/rooms/{id}/stream` and GET `/chats/rooms/{id}/stream/active`. Existing operations have no changes; no Core contract or dependency changed.
- `ChatService+Streaming` returns incremental HTTP bodies, sends one user UIMessage with its client ID and workspace context, maps Core errors, and treats resume 204 as idle. `DirectStreamMessage` accumulates text/reasoning parts and rejects out-of-order updates while retaining partial content on errors.
- Verified single-byte SSE framing (including UTF-8), multiple text parts, reasoning, completion, invalid ordering, partial errors, POST payload/context, idle resume, and lock conflicts. CoreAPI build succeeded; all 156 chat tests and strict SwiftLint passed (`/tmp/slice09-core-build.log`, `/tmp/slice09-chat-test.log`, `/tmp/slice09-lint.log`).
- Still incomplete: stream session lifecycle, Direct eligibility/composer locking, overlay reconciliation, thinking/reasoning views, cancellation and resume integration, app tests/build and iOS check. These changes remain on the same slice branch; no PR until the vertical slice is complete.

### Slice 09a lifecycle checkpoint (2026-09-10)

- Added UI-free `DirectStreamSession`: eligible one-human/one-coworker Directs only; scoped local task cancellation; idle resume without a shell; send locking through settlement; text/reasoning overlays; partial-content errors; no automatic POST retry. Successful history refresh clears overlays, failed refresh preserves them. A generation guard rejects old-room updates and settlement completions.
- Overlay reconciliation hides only the newest persisted user occurrence matching the active user turn; older repeated messages remain. Sender comes from the room member, as in the web hook.
- All 162 chat tests passed, including lifecycle/settlement/eligibility/repeated-message tests; strict SwiftLint passed; shared package builds for iOS 17 (`/tmp/slice09-session-all-tests.log`, `/tmp/slice09-session-lint.log`, `/tmp/slice09-session-ios.log`).
- Next: wire the session into WorkspaceState and the Direct composer/transcript, coordinate realtime refreshes, add thinking/reasoning presentation, then app tests and Xcode build. No PR yet; lifecycle code is not connected to the running app.

### Slice 09a app integration checkpoint (2026-09-10)

- WorkspaceState now owns/observes the shared stream session, resumes eligible Directs on open, cancels local consumption on clear/switch, sends through SSE instead of the classic outbox, and settles overlays through the existing latest-history refresh. Active streams suppress competing room full-event/envelope refreshes.
- Composer sends are locked while the Direct stream is busy; stream overlays do not offer Reply. Transcript shows stream errors, a thinking indicator, and a reasoning disclosure. This is initial presentation; exact thought timing/live-beat/persisted reasoning parity still needs verification and completion.
- Added an app test for stream routing, concurrent-send rejection, realtime echo suppression and persisted settlement. `xcodebuild test -only-testing:SokosumiTests -enableCodeCoverage NO` and strict SwiftLint passed (`/tmp/slice09-app-tests2.log`, `/tmp/slice09-ui-lint.log`).
- Remaining before PR: complete thought presentation against web, review resume/error/realtime edge cases, finish feature verification and native visual inspection where possible. No new API/dependency and no web edits.

### Slice 09a thought and error parity checkpoint (2026-09-10)

- Replaced the separate spinner/disclosure with a native expandable Thinking header and live elapsed timer, then a Thought disclosure after answer text. Persisted Core reasoning and `thought_timing_ms` now survive overlay settlement, with the same reasoning-only allowlist and seconds/minutes labels as web. Numeric-string and integer timestamps are covered by tests.
- Verified the installed AI SDK `src/ui/chat.ts`: its finish callback also runs after an active-stream error. Native now refreshes persisted history on that path too, retaining partial overlays only if refresh fails; the error remains visible.
- All 165 chat tests passed, strict lint/format passed, and Xcode app tests passed (`/tmp/slice09-thought-tests.log`, `/tmp/slice09-thought-lint.log`, `/tmp/slice09-thought-format.log`, `/tmp/slice09-thought-app-final2.log`).
- Remaining: final review of resume/realtime coordination, native visual inspection, final package checks, and one draft PR. An unrelated local Xcode project entry reorder appeared during this turn; it is left uncommitted, outside this feature's staged files.

### Slice 09a pre-PR verification (2026-09-10)

- Independent review found delete/thread envelopes suppressed while streaming. Fixed by forwarding thread events first and always applying deletions; an app regression verifies tombstones survive successful stream settlement. Re-review found no remaining important issues.
- Verification: 165 Chat tests, CoreAPI 1, Auth 34, Realtime 27; Xcode app tests; iOS 17 shared build; Apple Development signed build; lint and format. Logs: `/tmp/slice09-review-app.log`, `/tmp/slice09-final-{core,auth,realtime,ios,signed}.log`, `/tmp/slice09-thought-{tests,lint,format}.log`.
- Native CUA inspection: signed app launched, opened existing Hannah Direct, observed `Thought for 2m 44s`, expanded disclosure and verified its text and answer layout. Idle room showed no Thinking shell. No production message sent; incremental send/resume/error behavior is verified by fake transport tests, not a live provider round-trip.
- Out of this PR: thread streaming (09b), new Direct creation (10), rich message rendering, attachments, and mention execution. No web/Core/dependency changes. Existing local Xcode entry reorder remains unstaged.

### Slice 09a review fixes (2026-09-10)

- Pre-stream POST failures (409/503/network) clear the optimistic user overlay and restore the composer draft. They no longer look delivered. 409 still surfaces Core’s lock error; room re-entry already attaches via `/stream/active`.
- Settlement succeeds only when latest history actually applied. Older pages stay blocked while the Direct stream is busy. Overlay merge hides the newest matching persisted coworker row, so mark-read cannot flash a duplicate assistant bubble.
- Parent-root envelopes still request a room refresh while streaming when a thread is open. Competing room full merges stay skipped.
- Live Thinking shows the latest reasoning beat expanded (clamped) before answer text. The 10 Hz elapsed clock is hidden from VoiceOver.
