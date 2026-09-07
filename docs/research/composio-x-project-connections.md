# Composio X connections at Sokosumi project scope

Researched 2026-09-03 against official Composio and X Developer Platform documentation only. Repository observations are explicitly marked and are not external-source claims.

## Recommendation

Use Composio as the server-side OAuth credential broker and X tool executor, but keep Sokosumi Core as the authorization, project-association, scheduling, and audit authority.

Create one customer-owned X OAuth 2.0 app and one custom Twitter auth config per deployment environment. At connection time, make the connecting human's stable Sokosumi user ID the Composio `userId`, create a **SHARED** connected account, and grant only an opaque per-project Core executor ID access to it. Store the resulting connected-account ID against the Sokosumi project. Every publish, schedule, disconnect, and connection-status operation must first authorize the caller against that project in Core.

Do not model a Sokosumi project directly as the Composio `userId`. Composio's callback identity verifier requires the authenticated caller to prove the same `userId` that began the connection. A project ID cannot prove which human completed the OAuth flow. The user-owned, shared-to-project-executor model preserves that protection while keeping use project-scoped.

## Current capability and prerequisites

Composio's current Twitter toolkit is OAuth 2.0, has no Composio-managed app, exposes 79 tools, and has zero Composio triggers. Its documentation says that managed Twitter credentials were removed in February 2026, so a customer-owned X app and custom Composio auth config are mandatory. [C1] [C2]

For a production publishing integration:

1. Create and approve an X developer account, then create a Project and App in the X Developer Console. X identifies these as prerequisites for creating posts. [X1] [X2]
2. Enable OAuth 2.0 user authentication in the X app. Use a confidential **Web App** or **Automated App / Bot** type because Core, not the browser, can protect the client secret. Register the exact current Composio callback URL shown by the auth-config flow. X requires an exact callback-URL match; Composio's Twitter guide specifically warns not to reuse a legacy callback URL. [X3] [X4] [C2]
3. Create a custom Composio Twitter auth config with the X OAuth client ID, client secret, and application bearer token. The bearer token is needed for toolkit actions that use app-only X authentication; user OAuth scopes do not repair an app-only bearer-token failure. [C2]
4. Request only the scopes needed. X's create-post endpoint requires `tweet.read`, `users.read`, and `tweet.write`; add `offline.access` for a renewable connection and `media.write` only when the product supports uploads. [X5] [X4]
5. Select and fund an X API product/plan that allows every endpoint enabled in Sokosumi. X access is plan-based, and Composio documents X `UsageCapExceeded`, rate-limit, and developer-project/app-link failures as external-account conditions rather than OAuth-scope problems. [X1] [C1] [C2]

X access tokens from the OAuth 2.0 authorization-code-with-PKCE flow last two hours by default. Requesting `offline.access` yields a refresh token, allowing Composio to renew access without another prompt; X describes that scope as keeping access until the user revokes it. [X4]

## Scope mapping

Composio's **Organization / Project** is its own tenancy boundary: a Composio project scopes API keys, auth configs, connected accounts, and webhooks. It is appropriate for Sokosumi production versus staging isolation, but it is not a Sokosumi customer project. [C3]

Within a Composio project, a connected account belongs to the supplied stable `userId`. It is PRIVATE by default, so only that owner can use it. A SHARED connection is available only when explicitly pinned into a session and its per-connection ACL permits the requesting `userId`; it defaults to deny. [C4] [C5]

Use the following identifiers and records:

| Concern | Recommended representation | Reason |
| --- | --- | --- |
| OAuth connector | `sokosumi:user:${userId}` | A stable human identity that can complete Composio callback identity verification. |
| Project executor | `sokosumi:project-executor:${projectId}` | An opaque Core-only identity that can use the shared connection for both immediate and scheduled publishing. It is never returned to the browser or an agent runtime. |
| Composio account type | `SHARED`, ACL `allowedUserIds: [projectExecutorId]` | Gives Core one explicitly scoped executor. Do not use `allowAllUsers`; Core is still the source of truth for project membership and roles. [C5] |
| Sokosumi persistence | A project integration row containing the Composio connected-account ID, auth-config ID, connector user ID, X account identity where available, status, and audit timestamps | Associates the opaque Composio credential with the project without storing OAuth tokens locally. |

This avoids syncing every project member into Composio's ACL, including its 1,000-entry ACL-list limit. It also means that an ex-member cannot use the X account: Core simply does not create an executor session for unauthorized callers. The connector remains a Composio-level creator, so Core must continue to reject use by that person after removal from the project. Composio ACLs are a defense in depth layer, not Sokosumi's authorization model. [C5]

## Connection and execution flow

1. A real interactive user with an explicit project-integration management permission initiates the flow through Core. Do not let a coworker, orchestrator, or unauthenticated callback initiate it.
2. Core validates project access, writes a short-lived, one-use local connection intent, and asks Composio to create a Twitter connection for `sokosumi:user:${userId}` using the pre-created custom auth-config ID. Create it as `SHARED` with only that project's executor ID in its allow list. Composio's TypeScript session `authorize()` and `connectedAccounts.link()` both support this experimental account type and ACL shape. [C5] [C6]
3. Send only Composio's hosted redirect URL to the browser. The X client secret, bearer token, Composio project API key, and connected-account token values never cross the Core-to-browser boundary. Composio's Connect Link handles the provider sign-in and stores/refreshes the resulting tokens. [C4] [C7]
4. Enable Composio's project-level callback identity verification. Core receives the single-use `session_uri`, authenticates the returning Sokosumi user, and completes the connection with the same `sokosumi:user:${userId}` used at initiation. A mismatch fails the connection rather than binding a victim's X account to an attacker's identifier. [C7]
5. Persist the `ca_...` ID only after Composio reports `ACTIVE`. Do not trust a browser-supplied connected-account ID without checking it against the local intent, expected toolkit/auth config, and connector identity. Composio states that an abandoned link stays `INITIATED` until it expires. [C6] [C7]
6. For a publish, Core re-checks project authorization and creates a short-lived session as `sokosumi:project-executor:${projectId}`, pinning that project's exact connected account. Limit the session to Twitter's `TWITTER_CREATION_OF_A_POST`, disable connection management and the sandbox, execute the tool, record the returned X post ID, then delete the session. Sessions otherwise start with broad toolkit discovery and sandbox capabilities enabled. [C6] [C8] [C9]

Illustrative server-only TypeScript pattern, not a drop-in implementation:

```ts
const session = await composio.sessions.create(projectExecutorId, {
  toolkits: ["twitter"],
  tools: {
    twitter: { enable: ["TWITTER_CREATION_OF_A_POST"] },
  },
  authConfigs: { twitter: twitterAuthConfigId },
  connectedAccounts: { twitter: [connectedAccountId] },
  manageConnections: false,
  sandbox: { enable: false },
});

const result = await session.execute("TWITTER_CREATION_OF_A_POST", { text });
await session.delete();
```

The SDK documents `sessions.create(...)` as the preferred replacement for the top-level alias, `connectedAccounts` as the way to pin a selected account, and `session.execute()` as provider-independent execution. For a deterministic direct-execution implementation instead, pin the toolkit's dated version: Composio intentionally rejects a bare/latest version for manual execution to avoid unreviewed toolkit changes. [C6] [C8] [C9]

## Token lifecycle and disconnect

| Event | Required behavior |
| --- | --- |
| Normal use | Let Composio store and refresh tokens. Treat a non-`ACTIVE` connection or tool authentication failure as unavailable; ask the connector to reconnect rather than exposing a token. [C7] [X4] |
| X credentials/scopes changed | Reconnect. X says changing permissions requires re-authorization, and regenerating credentials invalidates the old values. [X3] [X1] |
| Project disconnect | First atomically disable future local publishes/schedules, then call Composio's v3.1 revoke endpoint. It makes a best-effort provider revocation, returns exactly which token subjects were revoked, and moves the connection to `REVOKED` on success. Then delete or retain only a non-executable audit record locally. [C10] |
| Revocation unavailable or failed | Block the local integration immediately. Composio can return 400 when a toolkit lacks programmatic revocation or 500 when upstream dispatch fails, so the UI must report that upstream revocation was not confirmed and provide the X deauthorization/reconnect path. [C10] |
| Temporary suspension | Disable the connected account rather than deleting it only when a later re-enable is intended. Composio distinguishes disable/enable from permanent delete; delete removes the platform connection and its associated access. [C11] |

Test the upstream behavior with one X account connected to more than one Sokosumi project before promising that a project disconnect is isolated from other X grants. Composio describes revocation as provider-side and best-effort, not as a project-local token revocation guarantee. [C10]

## Core-service integration fit

**Repository observation:** Core already has a server-only REST client at `apps/core/src/clients/composio.client.ts`, reads `COMPOSIO_API_KEY` from Core environment validation, and calls Composio with `x-api-key`. It also has an ownership-safe schedule sync mechanism in `apps/core/src/routes/sync/task-schedules/get.ts` and `apps/core/src/services/task-schedules-sync.ts`.

Extend that Core client for new project-connection behavior rather than putting a Composio key in Web or adding browser-side OAuth logic. For new endpoints, use Composio REST v3.1: it is the current API; v3 remains supported but is the prior version. If adopting `@composio/core` for the restricted execution-session pattern above, pin an exact package version because the SHARED-account ACL surface is documented as experimental. [C3] [C5] [C8]

**Repository observation:** the existing `ensureAuthConfig()` helper creates `use_composio_managed_auth` configs (`apps/core/src/clients/composio.client.ts:684-751`). It cannot provision Twitter now. X must use an explicitly provisioned custom auth-config ID, and the existing Twitter MCP write allow list already identifies `TWITTER_CREATION_OF_A_POST` (`apps/core/src/clients/composio.client.ts:450-469`).

Use a scoped Composio project API key with only the required permissions: connected-account read/write for link/status/revoke, sessions write when using sessions, and tool-execution write for posting. Do not grant Proxy Execute, triggers, or auth-config write to the runtime key unless a confirmed use requires it. Composio supports immutable scoped-key permissions and IP allowlisting. [C12] [C13]

## Security and authorization controls

- Keep the Composio project API key and X client secret in Core-only secret storage. A Composio project key can create/revoke connections and execute tools; X classifies Web App and Automated App clients as confidential specifically because they can protect the client secret. [C12] [X3]
- Authorize on the Sokosumi project for every Core endpoint and every background publish. Never accept `projectId`, Composio `userId`, connected-account ID, callback URL, or tool arguments from the browser as authority.
- Enable Composio callback identity verification and retain a server-side one-time intent for project, connector, and requested capability. This mitigates OAuth session fixation, which Composio explicitly identifies for unauthenticated Connect-Link completion. [C7]
- Use a dedicated custom X auth config per environment and an X app per environment. X recommends distinct apps for development, staging, and production. [X3]
- Limit OAuth scopes and session tools to the publishing feature. Do not expose the full 79-tool Twitter catalog, direct proxy execution, raw MCP URL, or sandbox to a publish flow. [C1] [C8]
- Configure Composio project log storage deliberately. By default it retains tool request/response payloads for up to one year; "Don't store data" keeps audit metadata but not those payloads for new calls. [C14]
- Log the Sokosumi project, authorized actor or scheduler, connector, connected-account ID, requested publish time, tool version, result, and X post ID. Do not log OAuth values, Composio keys, or a Connect Link.

## Publishing and scheduling limits

Composio can immediately publish with `TWITTER_CREATION_OF_A_POST`; X's API publishes through `POST /2/tweets` using a user access token. The documented Composio tool and X request schema have post-content, media, reply, quote, poll, and disclosure fields but no future publish-time field. Therefore, scheduled posting must be a Sokosumi Core responsibility: persist a scheduled post, have the existing protected Core scheduler claim it when due, then run the restricted publish session. This is an inference from the cited request schemas, not a Composio scheduling feature. [C1] [X5] [X2]

Relevant product limits:

- Composio reports zero Twitter triggers, so it is not a scheduling or X-event trigger solution. [C1]
- X's create-post endpoint requires user-context authorization. App-only bearer authentication is for public reads, not posting. [X2] [X4]
- Media must be uploaded before post creation. A post supports at most four photos, one animated GIF, or one video, and post-time media caps depend on the posting account's X status. [X5]
- Quote-posting through `quote_tweet_id` requires an X Enterprise plan; self-serve API posts are limited to one cashtag, and self-serve replies have additional mention/quote constraints. [X5] [X2]
- If scheduled media processing or the Composio connection is not ready at dispatch time, leave the schedule in a retryable/failed state and require an explicit retry policy. Do not silently post a changed payload.

## Sources

| ID | Official source |
| --- | --- |
| C1 | [Composio Twitter toolkit](https://docs.composio.dev/toolkits/twitter) |
| C2 | [Composio Twitter/X configuration guide](https://docs.composio.dev/kb/guide/toolkits-twitter) |
| C3 | [Composio projects](https://docs.composio.dev/reference/api-reference/projects) |
| C4 | [Composio authentication model](https://docs.composio.dev/docs/authentication) |
| C5 | [Composio shared connections](https://docs.composio.dev/docs/extending-sessions/shared-connections) |
| C6 | [Composio TypeScript Session reference](https://docs.composio.dev/reference/sdk-reference/typescript/session) |
| C7 | [Composio connected accounts and callback identity verification](https://docs.composio.dev/reference/api-reference/connected-accounts) |
| C8 | [Composio session configuration](https://docs.composio.dev/docs/configuring-sessions) |
| C9 | [Composio TypeScript tool execution reference](https://docs.composio.dev/reference/sdk-reference/typescript/tools) |
| C10 | [Composio connected-account provider revocation](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsByNanoidRevoke) |
| C11 | [Composio TypeScript connected-account lifecycle methods](https://docs.composio.dev/reference/sdk-reference/typescript/connected-accounts) |
| C12 | [Composio scoped project API-key permissions](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions) |
| C13 | [Composio security overview](https://docs.composio.dev/docs/security/overview) |
| C14 | [Composio data retention](https://docs.composio.dev/docs/security/data-retention) |
| X1 | [X API: getting access](https://docs.x.com/x-api/getting-started/getting-access) |
| X2 | [X API: manage posts](https://docs.x.com/x-api/posts/manage-tweets/introduction) |
| X3 | [X developer apps](https://docs.x.com/resources/fundamentals/developer-apps) |
| X4 | [X OAuth 2.0 authorization code flow with PKCE](https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code) |
| X5 | [X API: create posts](https://docs.x.com/x-api/posts/create-post) |
