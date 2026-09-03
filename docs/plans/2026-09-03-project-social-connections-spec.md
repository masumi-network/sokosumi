# Project social connections for X

Glossary: `CONTEXT.md`. Decision: `docs/adr/0018-core-owned-project-social-connections.md`. Research: `docs/research/composio-x-project-connections.md`.

## Requirement

Sokosumi Projects can connect multiple X accounts through `Project settings > Social accounts`. A Social account may be deliberately connected to more than one Project, but each Project social connection is independently authorized, managed, disconnected, and audited. The connection grants the Project's future scheduler permission to publish through that account until disconnected.

## Problem Statement

Sokosumi has no native, Project-scoped way to connect an external publishing identity. Users cannot prepare a Project for native social scheduling, and provider OAuth connections in the existing product serve Hermes rather than the Project. Credentials, authorization, lifecycle, and audit records need one secure owner before posting or scheduling can be added.

## Solution

Add a provider-agnostic Project social connection resource in Core, exposing X as the first and only supported provider. Core validates the interactive human's Workspace access, brokers X OAuth with Composio, records the Project association and non-executable audit history, and never exposes provider credentials to Web. Web adds a Social accounts section to Project settings where Workspace humans can connect, view, reconnect, replace, or disconnect X accounts.

The initial release creates the foundation only. It does not compose, post, upload media, schedule, or display social history. Connecting explicitly grants the Project's future scheduler authority to publish as that account; future scheduling will be a Core capability rather than an X or Composio delayed-post feature.

## User Stories

1. As a human in a Project's Workspace, I want to open Social accounts in Project settings, so that I can prepare the Project for social publishing.
2. As a Social connection manager, I want to connect an X account from a specific Project, so that the Project gains only an explicitly granted publishing authorization.
3. As a Social connection manager, I want the X OAuth flow to open only after Core has authorized my Workspace access, so that a copied Project ID cannot start a connection.
4. As a Social connection manager, I want to return from X OAuth to the same Project and see the connection result, so that I know whether the account is ready.
5. As a Social connection manager, I want to see the connected X account's identity and status, so that I can distinguish ready accounts from accounts that need attention.
6. As a Social connection manager, I want a Project to hold several distinct X accounts, so that brand, campaign, or regional identities can be prepared independently.
7. As a Social connection manager, I want the same X account to be connectable to another Project through another explicit OAuth flow, so that account reuse does not expose cross-Project account inventory.
8. As a Social connection manager, I want the Project to reject a duplicate active connection to the same X account, so that a future scheduler cannot have ambiguous credentials.
9. As a Social connection manager, I want to reconnect an X account that needs reauthorization, so that the original publishing identity can become usable again.
10. As a Social connection manager, I want reconnecting to reject a different X identity, so that an authorization refresh cannot silently change where a future post is published.
11. As a Social connection manager, I want to replace an X account deliberately, so that an identity change is explicit and auditable.
12. As a Social connection manager, I want to disconnect one Project's X account without affecting another Project that uses the same account, so that Project authorization remains isolated.
13. As a Workspace human who did not complete the original OAuth flow, I want to manage an existing Project social connection, so that the connection belongs to the Project rather than one employee.
14. As a Project scheduler in a future release, I want a valid Social scheduling authorization, so that due social work can publish without requiring the original connector to be online.
15. As a person who leaves a Workspace, I want my departure not to silently disable the Project's approved publishing authorization, so that the remaining Workspace can continue its work or disconnect it deliberately.
16. As a coworker, orchestrator, or API-key caller, I cannot initiate, inspect, reconnect, replace, or disconnect a Project social connection, so that external publishing credentials remain human-managed.
17. As a human outside the Project's Workspace, I cannot learn whether or which X accounts that Project uses, so that Project social identity remains private.
18. As a support engineer, I can investigate a connection lifecycle from non-secret audit records, so that failed or revoked connections are diagnosable without exposing OAuth values.
19. As a Project owner, I expect a future Project close to disable and disconnect its Social connections while retaining non-executable audit records, so that a terminal Project keeps no publishing authority.
20. As a security reviewer, I want Composio and X secrets to remain server-side, so that browser clients and automation actors never receive reusable publishing credentials.

## Implementation Decisions

- **Single seam: Project social connections.** A Core Project resource owns Project authorization, connection intents, Composio calls, state transitions, provider references, and audit records. Web's Project settings service/action layer is its only product client. The existing OAuth popup transport is reusable, but the Project lifecycle is independent from Hermes connections.
- **Provider-agnostic persistence, X-only behavior.** Persist a provider discriminator and a normalized external Social account identity so other providers can be added without a schema redesign. The API, UI, and Composio configuration accept only X in this release. Do not build a plugin framework or generic provider catalogue.
- **Cardinality.** A Project has multiple Project social connections. One external Social account can be associated with multiple Projects only by a new OAuth flow begun from each Project. Do not surface an account picker or connection inventory outside the current Project. Only one active X connection for the same external account may exist within a Project.
- **Human management policy.** A Social connection manager is an interactive, logged-in human in the Project's Workspace. User API keys, coworkers, orchestrators, and other automation actors are rejected. This is intentionally broader than owner-only Project editing: every eligible Workspace human can view and manage these connections.
- **Connection state.** Model a short-lived, single-use connection intent separately from the durable Project social connection. The durable resource maps provider lifecycle responses into pending, active, reauthorization-required, and disconnected product states. After Composio reports `ACTIVE`, Core opens a transient session pinned to that account and permits only `TWITTER_USER_LOOKUP_ME` to retrieve the stable X id and handle. Persist that non-secret identity with the provider account reference; never store OAuth access or refresh tokens in Sokosumi.
- **Identity-safe OAuth.** Core authorizes the Project and creates the intent before returning a Composio-hosted link. The intent binds the Project, initiating human, provider, custom X auth configuration, expected connection, and callback completion. Callback identity verification must prove the same human identity that initiated the flow. Core validates the completed account against the intent before persisting it.
- **Reconnect and replace.** Reconnect authorizes the same external X identity only. Replace first removes the old Project authorization and then initiates a distinct connection flow; it may not mutate an existing connection into a different identity.
- **Disconnect and provider revocation.** Disconnect immediately makes the Project social connection non-executable and writes an audit record. It must not affect another Project's valid authorization. Provider-side revocation runs only when no remaining Project social connection references that underlying Composio connection. A failed provider revocation remains visible in the audit record while local use stays blocked.
- **Project lifecycle.** A future Project-close command must use the same disconnect lifecycle for every active Project social connection. Creating a Project-close feature is not part of this release because no such product command exists today.
- **Composio boundary.** Core uses Composio's current API for a customer-owned X OAuth application and custom X auth configuration. Composio stores and refreshes provider tokens; Core remains the authority for all Project checks, scheduler permission, state transitions, and audit data. Use a stable user-scoped connector identity for callback verification and a Core-only Project executor identity for later restricted posting sessions.
- **Least privilege.** Use X's post-related OAuth scopes plus renewable access, but do not request media scope until media publishing exists. The initial identity session pins one connected account and enables only `TWITTER_USER_LOOKUP_ME`; future publishing sessions enable only the post-creation tool. No session may expose broad toolkit discovery, proxy execution, sandbox, triggers, or browser-exposed Composio keys.
- **Audit.** Record connect, reconnect, replace, disconnect, provider-revocation outcome, and future Project-close actions with the Project, connection, external identity, actor or scheduler, timestamps, and non-secret provider outcome. The release writes this data but does not add a history UI.
- **Web to Core boundary.** Add documented Core endpoints and regenerate the Web Core client. Web coordinates popup state and Project-settings feedback through its service/action layer; it does not access Prisma, Composio, X, or OAuth values directly.
- **Operational configuration.** Each environment needs its own customer-owned X developer application and Composio custom X auth configuration. Core receives only the scoped Composio project API key and X auth-config identifier. X app setup, billing plan, callback registration, scoped Composio permissions, IP policy, and Composio data-retention configuration are deployment prerequisites.

## Testing Decisions

- Test observable lifecycle behavior and authorization boundaries, not internal helper calls or Prisma query shapes.
- Core route and service tests cover Workspace membership, interactive-session-only management, no cross-Workspace visibility, missing Project, and rejection of coworkers, orchestrators, and user API keys.
- Test connection intents as one-use and short-lived: a mismatched user, Project, provider, callback, or completed connected-account identity must fail without creating a Project social connection.
- Test active connection creation, the restricted X identity lookup and response parsing, status refresh, expired/failed provider status, reauthorization, same-identity reconnect, explicit replacement, duplicate-in-Project rejection, and several distinct accounts per Project.
- Test that another Project can establish its own authorization for the same X account without discovering the first Project's connection and without being affected by the first Project's disconnect.
- Test disconnect as an immediate local block, provider revocation only after the last reference, and an upstream revoke failure that remains auditable but cannot restore local use.
- Test audit-record contents for every state change and assert that OAuth values, Composio API keys, hosted connection links, and raw provider credentials never appear in API responses, logs, or audit records.
- Web tests cover the Social accounts empty state, connected and reauthorization-required states, connect/reconnect/replace/disconnect controls, popup success/failure/abandon behavior, and inaccessible controls for non-human actors where relevant to the client contract.
- Add OpenAPI contract coverage for the new Project social-connection endpoints, regenerate the Web client, and typecheck Web against the generated DTOs.
- Prior art: the existing Project route tests, Composio client tests, Hermes OAuth callback tests, Web OAuth popup-protocol tests, Project service/action tests, and Project form/component tests.

## Out of Scope

- Creating, editing, previewing, approving, or immediately publishing X posts.
- Uploading or processing X media, polls, replies, quotes, analytics, direct messages, or other X toolkit actions.
- Creating social schedules, changing the Calendar, or invoking the Core scheduler to publish.
- Supporting providers other than X or exposing a generic provider marketplace.
- Showing cross-Project or cross-Workspace account inventory.
- A Project social-connection history UI or end-user audit-log page.
- Building the missing Project-close command itself.
- Automating X developer-account approval, X API plan purchase, Composio custom auth-config setup, provider callback registration, or production secrets provisioning.

## Further Notes

- X does not provide a future-publish parameter through the relevant post API. Native social scheduling must persist schedule state and dispatch from Core when due.
- Composio's X toolkit has no managed credentials. The deployment prerequisite is a customer-owned X OAuth application per environment and an explicit custom auth configuration.
- Verify provider revocation behavior with one X identity deliberately connected to multiple Projects before treating an upstream revoke as isolated. Local Project authorization must always be blocked first.
- This spec is intentionally local and unfiled. It is ready to become a requirement issue only when explicitly requested.
