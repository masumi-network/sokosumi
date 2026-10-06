# Custom chat result previews

SOK-1306 adds readable previews of Soko Bot work to chat. Users can inspect posts, tasks, generation results, delegated jobs, deliverables, and requests without leaving the conversation, then open the underlying resource for further work. Cards primarily show recorded results. They do not become a second editor or grant permission to perform an operation.

Requirement: https://linear.app/masumi/issue/SOK-1306/show-bot-results-with-custom-chat-previews

## Scope and success

Deliver six kinds of preview in the Web chat experience:

1. Social post, including scheduled posts.
2. Task, including scheduled tasks.
3. Content Studio generation and its output assets.
4. Approval or request for input backed by an existing decision or task.
5. Delegated marketplace job and its results.
6. File or artifact, including documents, spreadsheets, reports, and media.

Soko Bots can request a preview through validated resource references and receive a clear success or failure result. The preview survives reopening the chat. Bot instructions explain which reference to use and how to handle unsuccessful or incomplete work. Existing human messages and older bot messages continue to render normally.

## Approaches considered

**Parse ordinary message links.** This would reuse unfurls but lose reliable type and state information. It cannot safely represent a pending job, a schedule, or a durable decision. Do not use prose parsing as the card contract.

**Let bots supply complete card payloads.** This is easy to call but permits invented state, links, and names and duplicates resource authorization in clients. Do not trust model-authored display data as platform state.

**Resolve resource references in Core.** Extend the existing chat publication path with optional typed references. Core validates and reads the real resources, produces bounded snapshots, and persists them with messages. Web renders those snapshots. This is the proposed approach.

## Message contract and persistence

Add an optional structured result collection to the existing chat message contract. Each entry has a type discriminator, resource reference, recorded timestamp, and a validated snapshot sufficient to render the corresponding card. Bound collection size and field lengths. Define the source schemas in Core and the bot input references in the existing shared bot contracts. Regenerate the Core client from those sources.

Store results in the existing message metadata JSON alongside other message metadata; no new database table is needed for snapshots. Promote only validated result fields into the message DTO, following the existing unfurl and skill attachment pattern. Keep plain explanatory content so unsupported clients and message summaries remain understandable.

Use the existing bot message publication and delivery paths, including room replies and the owner's conversation. A successful tool call that requests a preview must persist the same payload the message readers receive; failed authorization or resource lookup must not produce a success card. Preserve publication idempotency so retries do not duplicate messages.

## Bot tools and instructions

Extend the existing posting capability with optional result references rather than adding one tool per visual component. Resource references identify existing task, task schedule, Social post, studio job, marketplace job, file, or decision records. Include project context where the resource requires it.

Make the same reference mechanism available on the bot's answer delivery path, so displaying a card does not require an extra post or grant posting capabilities to restricted turns. Inspect the existing answer/publication contract during implementation and extend its established seam.

Core resolves references with the bot's existing authorized resource readers and rejects unrelated, inaccessible, or invalid resources. Bots may not supply arbitrary HTML, status labels, approval actions, download URLs, or asset URLs.

Add a reusable bot instruction module and include it in a new prompt version using the repository's versioning convention. Released prompt versions and frozen skills stay unchanged. Instructions cover selection of result types, real identifiers, pending and failed results, multiple outputs, explanatory text, and publication failures. Existing task, Social, generation, budget, and communication permissions remain in force.

## Card behavior

**Post:** Show text, available media, destination provider/account, status, and scheduled time with timezone when present. Link to the originating Social post. Drafts and scheduled posts must be visibly different.

**Task:** Show title, status, assignee and project when present, and a task link. Optional task execution schedule details add date/time, timezone, and recurrence. Bot follow-up cron prompts are distinct resources and must not be presented as execution schedules for a task. When a bot schedule is shown, identify it as a bot follow-up.

**Studio:** Show prompt summary, pending/running/failed/completed state, and available generated assets. Render multiple outputs using the existing media/file preview patterns. Link to the originating Content Studio result. A preview reads generation state; it does not start another paid generation.

**Approval or request:** Reuse existing durable decision rendering and resolution for legacy/current decision records where supported. The current bot policy no longer exposes request_user_decision as a general capability; do not restore that capability or insert new approval gates. Tasks waiting for input produce request cards with the actual question and a link to the existing reply surface. Only authorized owners receive existing decision response controls.

**Job:** Show the marketplace agent, work summary, recorded execution state, failure explanation when available, and links to the job and outputs. Do not merge marketplace jobs with Content Studio jobs; their resource references and permission checks differ.

**File:** Show filename, type, available size, and the existing file/media preview. Use existing protected open/download routes. Unsupported media remains an understandable file card. Studio and job result cards reuse this output presentation.

Reuse the established compact chat preview frame and semantic color tokens rather than copying full taskboard cards into the transcript. Keep card content bounded and wrap long names and summaries. Use translated labels, locale-safe date formatting, accessible links and controls, and existing light/dark theme tokens.

## Authorization and information boundaries

Membership in a chat does not grant access to a project, private file, or another owner's bot. Check the bot's resource access when producing a preview and the reader's access when delivering sensitive snapshot data. Do not broadcast private snapshot fields or protected media URLs to an entire room merely because the posting bot can read them. Follow the existing message personalization seam; inaccessible resources receive a generic unavailable result rather than their private title, prompt, content, or account details.

Approval controls must use existing server authorization and current decision status. A historical snapshot is not authority to execute an action. Media URLs must use existing protected resource routes and URL validation. No credentials or connection internals belong in result payloads.

## History and unavailable resources

Each card explicitly describes a result recorded at its captured timestamp. Do not label a snapshot as live status. Users open the source to inspect its current state. This avoids a polling subscription for every historical card while preserving an honest transcript.

Resolve access and availability at delivery. Deleted or inaccessible resources display a localized unavailable message without leaking their former contents. Unknown or invalid stored result types must not break the message row; retain the explanatory text and an unavailable/unsupported fallback where appropriate.

## Validation

Contract tests cover valid references, invalid types, collection limits, and malformed stored metadata. Core tests cover successful resolution for each resource kind, unauthorized and missing resources, protected delivery, and retry idempotency. Include paths for both owner answers and explicit room posts.

Web tests cover all card types, scheduled task variants, multiple generated outputs, missing media, unavailable resources, historical state labels, and authorized decision controls. Verify translation catalog parity, code generation, TypeScript, relevant package/Core/Web tests, and repository formatting checks.

Before the draft PR, review the complete diff and verify the UI in the supported local environment where credentials are available. Attach screenshots showing representative cards at desktop and mobile widths. Report any unavailable authenticated UI proof explicitly.

## Non goals

No full inline editing, rescheduling, Social publishing, or generation composer. No new generation models, billing rules, independent approval system, or database-backed preview subsystem. No redesign of Social, Tasks, or Content Studio. Native Apple UI parity is outside this first change.
