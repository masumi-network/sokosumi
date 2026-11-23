# Agents draft and stop; a person publishes, sends and starts ad spend

- Status: Proposed
- Date: 2026-11-23

An agent that works through the CLI or the MCP server may prepare anything and may stop anything. Only a person starts something the world sees or that spends ad money: approving or publishing a Social post, approving, scheduling or sending a newsletter, and resuming an ad campaign. An agent's Social post therefore lands as **Needs approval**, as a Coworker's already does, and a newsletter issue goes through the submit-and-approve step it already has. Ad campaigns are created paused, as they already are, and an agent may change one only while it is paused. Credit spend in the image studio is open to agents, as hiring an agent with credits already is.

Here an **agent** is any user credential where no person is known to be at the keyboard: a Better Auth API key, a third-party OAuth token, an MCP token ([ADR 0076](0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md)) and a Coworker key. A **person** is a Sokosumi browser session.

**Why:** Sokosumi already has an approval step for these actions, built for Coworkers (Social posts) and Soko Bots (newsletters), and a paused-create rule for ads ([ADR 0073](0073-soko-bots-run-ads-through-the-projects-ad-account.md)). Reusing them adds no new concept. Core cannot see an outside agent's context, so it cannot tell a request the owner asked for from one a prompt injection in a web page asked for. A public post on a brand account, an email to a contact list and ad spend cannot be taken back. A person's approval is the only check Core can enforce.

## The routes today

These routes call `requireInteractiveUserAuthContext`, so API keys, OAuth and MCP tokens get 403. Its doc comment says it exists so a third-party client cannot mint a credential that outlives its consent. Only the connection routes match that reason; the rest borrowed it to mean "a person must do this".

| Action                                                        | Routes under `/v1/projects/{id}`                                                                                                   | What it costs or exposes                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Social post: create, edit, schedule, queue, duplicate, cancel | `social-posts` (`requireSocialPostActor`: person or Coworker)                                                                      | Nothing until it publishes                                                          |
| Social post: approve, reject, publish now                     | `social-posts/{postId}/approve`, `reject`, `publish`                                                                               | A public post on a brand account, under the brand's name                            |
| Social post: resume an X thread                               | `social-posts/{postId}/thread/resume`                                                                                              | A wrong answer posts a thread part twice, in public                                 |
| Newsletter: create, edit, AI draft, submit                    | `newsletter/issues` (open to every actor today)                                                                                    | Nothing until it sends                                                              |
| Newsletter: approve, schedule, send now                       | `newsletter/issues/{issueId}/approve`, `schedule`, `send-now`                                                                      | An email to every active subscriber; sender reputation                              |
| Newsletter: cancel                                            | `newsletter/issues/{issueId}/cancel`                                                                                               | Stops a send                                                                        |
| Ad campaign: create                                           | `ads/accounts/{accountId}/campaigns` POST                                                                                          | Nothing: always created paused                                                      |
| Ad campaign: edit, budget, pause, resume                      | `campaigns/{campaignId}` PUT, PATCH                                                                                                | Ad money, billed by Google or Meta to the customer's card, outside Sokosumi credits |
| Image studio: start an image, video, short or talking video   | `image-studio/jobs`, `video-jobs`, `short-video-jobs`, `talking-video-jobs`                                                        | Sokosumi credits; the balance check refuses an overspend                            |
| Image studio: cancel a job                                    | `image-studio/jobs/{jobId}/cancel`                                                                                                 | Stops a job                                                                         |
| Connect or remove a social or ad account                      | `social-connections/initiate`, `finalize`, `{connectionId}` DELETE; `ads/connections/*`; `ads/accounts` POST, `{accountId}` DELETE | A long-lived grant to post or spend in someone's account                            |

Reads on these routes open to agents in SOKD-378. Image-studio writes that neither spend nor publish (feedback, captions, headlines, products, brand logo) are ordinary writes and open with the projects wave of the parity rule.

## Decisions

| Action                                                     | Agent                                                     | Option                      |
| ---------------------------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Social post: create, edit, schedule, queue, duplicate      | Allowed; the post lands as Needs approval                 | (a)                         |
| Social post: cancel                                        | Allowed                                                   | stop                        |
| Social post: approve, reject, publish now, resume a thread | Person only                                               | (d)                         |
| Newsletter: create, edit, AI draft, submit                 | Allowed (no change)                                       | (a)                         |
| Newsletter: cancel                                         | Allowed                                                   | stop                        |
| Newsletter: approve, schedule, send now                    | Person only                                               | (d)                         |
| Ad campaign: create                                        | Allowed; always paused (no change in the service)         | (a)                         |
| Ad campaign: edit or change the budget                     | Allowed only while the campaign is paused (409 otherwise) | (a)                         |
| Ad campaign: pause                                         | Allowed at any time                                       | stop                        |
| Ad campaign: resume                                        | Person only                                               | (d)                         |
| Image studio: start a generation                           | Allowed                                                   | credits                     |
| Image studio: cancel a job                                 | Allowed                                                   | stop                        |
| Connect or remove a social or ad account                   | Person only                                               | (d), the guard's own reason |

- **An agent's write never publishes on its own.** After an agent creates, edits or schedules a Social post, the post is Needs approval, whatever its status was. Today a Coworker can schedule a person's draft straight to Scheduled, and can edit a Scheduled post's text while it stays Scheduled; both publish without anyone approving. This rule closes that for Coworkers too.
- **Stopping is always allowed.** Cancel and pause only make an outward effect smaller, and an agent that notices a mistake should be able to stop it.
- **Credits are their own cap.** An API key can already hire an agent and spend credits (`agents hire`). The image studio is the same kind of spend: prepaid, checked against the balance and the jobs in flight, and visible in transactions. The CLI and MCP tools always send an `idempotencyKey`, so a retry never buys a second image.
- **Ad money is not credits.** It is billed by Google or Meta outside Sokosumi, with no balance to stop it, so a person resumes every campaign.
- **An agent's ad update makes one change.** A PATCH carries a status or a budget, never both, as for Soko Bots ([ADR 0073](0073-soko-bots-run-ads-through-the-projects-ad-account.md)). So "pause, then lower the budget" is two calls, and the budget check always sees the campaign's current status.
- **A person-only route says so.** It answers 403 with its own message and error kind ("A person approves this in Sokosumi") and the item's Web link, instead of "Interactive session required to manage credentials", so the agent can tell its user where to go. Its manifest row is `"mcp": false` with the reason citing this ADR.
- **The approve, reject and send routes stay session-only.** Whether a first-party app (CMO, the Apple app, [ADR 0046](0046-first-party-clients-skip-consent.md)) may approve is decided per route when that app ships an approval screen.

## Considered options

- **(a) The agent drafts, a person approves in Sokosumi.** Chosen for drafting. The approval step, its queue and its Tasks already exist.
- **(b) Allowed, with MCP `destructiveHint` and the client's confirmation.** Rejected as a control. The hint is advice to the client: many clients auto-approve tools, the CLI has no such prompt, and an injected agent confirms its own call. MCP tools still carry correct annotations, which the server derives from the HTTP method.
- **(c) A per-workspace setting or spend cap.** Rejected for now. It adds a setting, its screen, who may change it and a check on every route, before anyone has asked for an agent on autopilot. If they do, a workspace switch "agents may publish" is the shape to propose, in a new ADR.
- **(d) Keep everything person-only.** Rejected as a blanket rule. It blocks drafting, which costs nothing, and pushes users back to the browser for work an agent does well. Kept for the steps that start an outward effect and for connecting accounts.
- **Let agents publish, as Soko Bots can.** Rejected. A Soko Bot runs inside Core: every turn keeps receipts, text from comments and the web marks the turn so it cannot act outward, a CMO bot needs an approved strategy, and deleting needs the owner's word in chat. An outside agent has none of that, and Core sees only its request.

## Consequences

- Follow-up tickets, under SOKD-360:
  1. **fix(core): send every Coworker change to a Social post back to Needs approval.** The gap above, on its own because it is live today.
  2. **feat(core): let agents draft, schedule and cancel Social posts and cancel newsletters.** `requireSocialPostActor` accepts every user credential and treats a non-session one like a Coworker; newsletter cancel opens; person-only routes get the new message.
  3. **feat(core): let agents create and pause ad campaigns and edit them while paused.** Resume stays person-only.
  4. **feat(core): let agents start image-studio generations.** Jobs, video, short and talking video, and cancel; CLI and MCP send an `idempotencyKey`.
  5. Each ticket adds its CLI and MCP rows and fixtures under the parity rule, or ships inside the projects wave if that lands first.
- `docs/agents/agent-surface.md` lists these person-only steps as a reason for `false`, citing this ADR.
- `requireInteractiveUserAuthContext` goes back to its own job: credentials and account connections.
- An agent's work waits for a person. That is the point: the approval queue becomes where agent work shows up.
- Soko Bots keep their own rules ([ADR 0073](0073-soko-bots-run-ads-through-the-projects-ad-account.md)); this ADR does not change them.
