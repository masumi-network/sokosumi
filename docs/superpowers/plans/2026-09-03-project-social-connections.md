# Project Social Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let interactive humans in a Project's Workspace connect, inspect, reconnect, replace, and disconnect X accounts from `Project settings > Social accounts` without exposing provider credentials.

**Architecture:** Core owns one Project social-connections resource, including the durable connection, short-lived OAuth intent, Composio operations, and non-executable audit records. Web consumes only generated Core DTOs through its Project service and server actions, and extends the existing Composio popup transport without using the Hermes connection lifecycle.

**Tech Stack:** Prisma/PostgreSQL, Hono and Zod OpenAPI, Composio REST v3.1, X OAuth 2.0, Next.js App Router, React, next-intl, Vitest, Testing Library.

**Spec:** `docs/plans/2026-09-03-project-social-connections-spec.md`

## Global Constraints

- Core is the authorization, scheduling-authorization, lifecycle, and audit authority; Composio holds provider credentials.
- Only a real interactive session user in the Project's Workspace may manage a Social connection. User API keys, coworkers, and orchestrators are rejected.
- X is the only provider in this release. The persistence model remains provider-agnostic without adding a provider plugin system.
- Never return, persist in Sokosumi, or log OAuth access tokens, refresh tokens, Composio API keys, or hosted OAuth URLs after initiation.
- Each OAuth completion must be bound to a single-use, 15-minute server-side intent containing the Project, initiating user, provider, action, and expected connection id.
- The initial UI is `Project settings > Social accounts`. It has no composer, post action, media flow, Calendar change, scheduler invocation, or audit-history UI.
- X identity resolution uses a session pinned to the new account and only `TWITTER_USER_LOOKUP_ME`; future posting must use a distinct restricted session.
- Update `messages/en.json`, `messages/de.json`, and `messages/es.json` with identical Social account key paths. Regenerate the Web Core client after every Core OpenAPI change.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Persist Project social-connection lifecycle state

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_add_project_social_connections/migration.sql`
- Modify: `apps/core/src/test/setup.ts`
- Modify: `apps/core/src/config/env.ts`
- Test: `packages/database/src/helpers/migration-prefix-uniqueness.test.ts` if the migration-prefix guard requires an updated expected list

**Interfaces:**
- Produces `ProjectSocialConnection`, `ProjectSocialConnectionIntent`, and `ProjectSocialConnectionAudit` Prisma models owned by `Project`.
- Produces connection states `pending`, `active`, `reauthorization_required`, and `disconnected`, represented as strings so adding future providers or states does not require an enum migration.
- Produces `COMPOSIO_X_AUTH_CONFIG_ID`, required by Core only and defaulted in Core Vitest setup.

- [ ] **Step 1: Add the failing Prisma-schema expectations to the nearest schema/migration test seam.**

```typescript
expect(prisma.projectSocialConnection).toBeDefined();
expect(prisma.projectSocialConnectionIntent).toBeDefined();
expect(prisma.projectSocialConnectionAudit).toBeDefined();
```

- [ ] **Step 2: Run the focused schema or migration guard.**

Run: `pnpm --filter @sokosumi/database test src/helpers/migration-prefix-uniqueness.test.ts`

Expected: the new social-connection model API is absent or the migration guard reports the missing migration prefix.

- [ ] **Step 3: Add the three models and Project relations, then generate a migration.**

```prisma
model ProjectSocialConnection {
  id                       String   @id @default(uuid(7)) @db.Uuid
  projectId                String   @db.Uuid
  provider                 String
  externalAccountId        String
  externalHandle           String?
  composioConnectedAccountId String
  status                   String
  activeExternalAccountKey String?
  connectorUserId          String
  connectedAt              DateTime?
  disconnectedAt           DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
}
```

Add the `Project` relation, a nullable active key constrained with `projectId` to prevent two active rows for one provider/account identity, a one-to-many audit relation, and an intent keyed by Composio's connection id. Generate the SQL with `pnpm prisma:migrate:dev --name add-project-social-connections`; do not hand-write generated migration SQL.

- [ ] **Step 4: Add Core-only configuration.**

```typescript
COMPOSIO_X_AUTH_CONFIG_ID: z.string().min(1).optional(),
```

Use the production value as a required precondition when beginning an X connection, and set a non-secret test value in `envDefaults` so Core tests do not require a local `.env` edit.

- [ ] **Step 5: Generate Prisma and run the focused guard again.**

Run: `pnpm prisma:generate && pnpm --filter @sokosumi/database test src/helpers/migration-prefix-uniqueness.test.ts`

Expected: generated Prisma types recognize all three models and the migration prefix is unique.

### Task 2: Build the Core Composio adapter and Project social-connection service

**Files:**
- Modify: `apps/core/src/clients/composio.client.ts`
- Test: `apps/core/src/clients/composio.client.test.ts`
- Create: `apps/core/src/services/project-social-connections.service.ts`
- Create: `apps/core/src/services/project-social-connections.service.test.ts`

**Interfaces:**
- Consumes Task 1's Prisma models and `COMPOSIO_X_AUTH_CONFIG_ID`.
- Produces `initiateProjectSocialConnection`, `finalizeProjectSocialConnection`, `listProjectSocialConnections`, and `disconnectProjectSocialConnection` service functions.
- Produces adapter functions that link a custom X auth config, query a connected account, create a least-privilege identity session, execute `TWITTER_USER_LOOKUP_ME`, and request provider revocation.

- [ ] **Step 1: Write failing adapter tests using mocked Composio responses.**

```typescript
it("returns the hosted link and connected-account id for custom X auth", async () => {
  await expect(initiateProjectXConnection(input)).resolves.toEqual({
    connectionId: "ca_123",
    redirectUrl: "https://connect.composio.dev/...",
  });
});

it("parses the authenticated X id and handle from lookup-me", async () => {
  await expect(getConnectedXIdentity(input)).resolves.toEqual({
    id: "123",
    handle: "sokosumi",
  });
});
```

- [ ] **Step 2: Run the Composio client test file.**

Run: `pnpm --filter core test src/clients/composio.client.test.ts`

Expected: imports or functions for project-scoped X connection operations are missing.

- [ ] **Step 3: Extend the adapter without changing Hermes behavior.**

```typescript
export interface ConnectedXIdentity {
  id: string;
  handle: string | null;
}

export async function getConnectedXIdentity(input: {
  connectedAccountId: string;
  executorUserId: string;
}): Promise<ConnectedXIdentity>;
```

Use the existing Core-only `composioFetch` boundary. Pin every Composio session to the one connected account, enable only `TWITTER_USER_LOOKUP_ME`, disable connection management and sandbox behavior, parse the tool result, and delete the session in `finally`. Keep the X auth-config id, Composio API key, hosted URL, and raw tool payload out of errors and return values.

- [ ] **Step 4: Write failing service tests for the lifecycle state machine.**

```typescript
it("rejects a callback from a different user or project", async () => {
  await expect(finalizeProjectSocialConnection(mismatchedInput)).rejects.toThrow(
    "Unknown or expired connection",
  );
});

it("blocks a duplicate active provider/account in one project", async () => {
  await expect(finalizeProjectSocialConnection(duplicateInput)).rejects.toThrow(
    "already connected",
  );
});
```

- [ ] **Step 5: Implement the service around one durable intent and audit seam.**

```typescript
export interface InitiateProjectSocialConnectionInput {
  projectId: string;
  userId: string;
  provider: "x";
  action: "connect" | "reconnect" | "replace";
  socialConnectionId?: string;
}

export async function initiateProjectSocialConnection(
  input: InitiateProjectSocialConnectionInput,
): Promise<{ connectionId: string; redirectUrl: string }>;
```

Validate the scoped Project before all reads or mutations. Persist the one-use intent before returning the redirect URL. On finalize, verify the user, Project, provider, requested action, expiry, and Composio account; wait only for active Composio state; resolve X identity; enforce the active Project/provider/account uniqueness rule; write one durable row and one audit record atomically; remove the intent only after success. Reconnect rejects a different X id. Replace marks the prior row disconnected before activating the new one. Disconnect blocks local execution and records the result before best-effort provider revocation; revoke only when no other active Project connection references that Composio account.

- [ ] **Step 6: Run the focused Core service and adapter tests.**

Run: `pnpm --filter core test src/clients/composio.client.test.ts src/services/project-social-connections.service.test.ts`

Expected: all lifecycle paths pass, including Composio failures that leave the Project connection locally blocked and audited.

### Task 3: Expose the Project social-connections OpenAPI resource

**Files:**
- Create: `apps/core/src/schemas/project-social-connection.schema.ts`
- Modify: `apps/core/src/routes/v1/projects/index.ts`
- Create: `apps/core/src/routes/v1/projects/[id]/social-connections/get.ts`
- Create: `apps/core/src/routes/v1/projects/[id]/social-connections/initiate/post.ts`
- Create: `apps/core/src/routes/v1/projects/[id]/social-connections/finalize/post.ts`
- Create: `apps/core/src/routes/v1/projects/[id]/social-connections/[connectionId]/delete.ts`
- Create: `apps/core/src/routes/v1/projects/[id]/social-connections/project-social-connections.routes.test.ts`

**Interfaces:**
- Consumes Task 2 service functions.
- Produces `GET /projects/{id}/social-connections`, `POST /projects/{id}/social-connections/initiate`, `POST /projects/{id}/social-connections/finalize`, and `DELETE /projects/{id}/social-connections/{connectionId}`.
- Produces OpenAPI DTOs containing only id, provider, external handle, status, connection timestamps, and initiation redirect data.

- [ ] **Step 1: Define failing route tests before mounting routes.**

```typescript
it("allows an interactive workspace user to list connections", async () => {
  const response = await app.request(`http://localhost/${PROJECT_ID}/social-connections`);
  expect(response.status).toBe(200);
});

it.each([COWORKER_CONTEXT_AUTH, ORCHESTRATOR_CONTEXT_AUTH, USER_API_KEY_AUTH])(
  "rejects a non-interactive actor",
  async (authContext) => {
    const response = await createApp(authContext).request(url);
    expect(response.status).toBe(403);
  },
);
```

- [ ] **Step 2: Run the new route test.**

Run: `pnpm --filter core test src/routes/v1/projects/[id]/social-connections/project-social-connections.routes.test.ts`

Expected: route modules and schemas do not exist.

- [ ] **Step 3: Add schemas and mount routes as one Project resource.**

```typescript
const initiateRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), provider: z.literal("x") }),
  z.object({ action: z.literal("reconnect"), socialConnectionId: z.string().uuid() }),
  z.object({ action: z.literal("replace"), socialConnectionId: z.string().uuid() }),
]);
```

Use `requireUserAuthContext` and `requireWorkspaceContext` in every handler, then require that the Project belongs to the current Workspace. Return standard `ok`, `created`, and error helpers. The list never includes disconnected audit history. The finalize endpoint takes the opaque Composio connection id only and looks up every other authority value server-side.

- [ ] **Step 4: Cover the full HTTP boundary.**

```typescript
expect(body.data).toEqual([
  expect.objectContaining({ provider: "x", externalHandle: "sokosumi", status: "active" }),
]);
expect(JSON.stringify(body)).not.toContain("access_token");
```

Add cases for missing or out-of-workspace Projects, malformed IDs, expired/mismatched intent, duplicate X id, same-id reconnect, different-id reconnect, replacement, disconnect, and provider revoke failure.

- [ ] **Step 5: Run Core checks and create the Web snapshot.**

Run: `pnpm --filter core test src/routes/v1/projects/[id]/social-connections/project-social-connections.routes.test.ts && pnpm --filter core typecheck && pnpm --filter core write-openapi-snapshot-for-web`

Expected: all endpoints appear in the Core OpenAPI snapshot with no credential fields.

### Task 4: Regenerate the Web client and add Project service/actions

**Files:**
- Modify: `apps/web/src/lib/services/project.service.ts`
- Modify: `apps/web/src/lib/actions/project/action.ts`
- Modify: `apps/web/src/lib/services/__tests__/project.service.test.ts`
- Modify: `apps/web/src/lib/actions/project/__tests__/action.test.ts`
- Regenerate: `apps/web/src/lib/clients/generated/core/*`

**Interfaces:**
- Consumes Task 3 generated DTOs.
- Produces `projectService.listSocialConnections`, `initiateSocialConnection`, `finalizeSocialConnection`, and `disconnectSocialConnection`.
- Produces session-bound server actions that revalidate the Project detail and edit paths after terminal mutations.

- [ ] **Step 1: Regenerate the generated Core client instead of editing it.**

Run: `pnpm --filter web generate:core:snapshot`

Expected: generated operation and DTO names for the four Project social-connection endpoints are available under `src/lib/clients/generated/core`.

- [ ] **Step 2: Add failing service tests against generated-client calls.**

```typescript
it("lists a project's active social connections", async () => {
  await expect(projectService.listSocialConnections(PROJECT_ID)).resolves.toEqual([
    expect.objectContaining({ provider: "x", status: "active" }),
  ]);
});

it("does not turn a Core request error into a success", async () => {
  await expect(projectService.initiateSocialConnection(PROJECT_ID, input)).rejects.toThrow();
});
```

- [ ] **Step 3: Run the focused service tests.**

Run: `pnpm --filter web test src/lib/services/__tests__/project.service.test.ts`

Expected: the Project service does not expose social-connection operations.

- [ ] **Step 4: Implement the service and server actions with plain action DTOs.**

```typescript
export const initiateProjectSocialConnection = withSession<
  { projectId: string; action: "connect" | "reconnect" | "replace"; socialConnectionId?: string },
  ActionResultDto<{ connectionId: string; redirectUrl: string }, ActionError>
>(async (input) => { /* Core call, then toActionResult */ });
```

Use `toActionResult` for expected Core errors, preserve generated DTOs instead of creating Prisma-shaped mirrors, and revalidate `/projects`, `/projects/${projectId}`, and `/projects/${projectId}/edit` after finalize or disconnect. Do not add Web environment variables or any direct Composio request.

- [ ] **Step 5: Add action tests and typecheck Web.**

Run: `pnpm --filter web test src/lib/actions/project/__tests__/action.test.ts && pnpm --filter web typecheck`

Expected: server actions return Flight-safe success/error DTOs and generated-client types match the Core contract.

### Task 5: Add the Project Settings Social accounts UI and OAuth flow

**Files:**
- Modify: `apps/web/src/app/(app)/projects/[projectId]/edit/page.tsx`
- Modify: `apps/web/src/app/(app)/projects/components/project-edit-modal.tsx`
- Create: `apps/web/src/app/(app)/projects/components/project-social-accounts.tsx`
- Create: `apps/web/src/app/(app)/projects/components/__tests__/project-social-accounts.test.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/de.json`
- Modify: `apps/web/messages/es.json`
- Modify if needed: `apps/web/src/i18n/message-namespaces.ts`

**Interfaces:**
- Consumes Task 4 Project service/action contracts and the existing `ComposioOAuthCallbackPayload` BroadcastChannel protocol.
- Produces a Project Settings section with active-account rows and connect, reconnect, replace, and disconnect controls.
- Produces translated labels in all supported locales with matching key paths.

- [ ] **Step 1: Add failing component tests for visible lifecycle states.**

```tsx
render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={connections} />);
expect(screen.getByText("@sokosumi")).toBeVisible();
expect(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
```

- [ ] **Step 2: Run the focused component test.**

Run: `pnpm --filter web test src/app/(app)/projects/components/__tests__/project-social-accounts.test.tsx`

Expected: the component and translated controls do not exist.

- [ ] **Step 3: Load active connections in the edit server component and render a focused client section.**

```tsx
const [project, socialConnections] = await Promise.all([
  projectService.getProjectById(projectId),
  projectService.listSocialConnections(projectId),
]);
```

Pass the generated DTOs to `ProjectEditModal`, then render `ProjectSocialAccounts` below the existing Project details form. Keep the page server-rendered; make only the interaction/popup section a client component.

- [ ] **Step 4: Implement popup handling with the existing BroadcastChannel protocol.**

```typescript
const result = await initiateProjectSocialConnection({ projectId, action, socialConnectionId });
const popup = window.open(result.value.redirectUrl, "_blank", "popup,width=520,height=720");
// On a successful ComposioOAuthCallbackPayload, call finalizeProjectSocialConnection.
```

Validate that the callback connection id equals the initiation result before finalizing. Show an actionable error for blocked popup, cancelled OAuth, provider error, expired intent, different-account reconnect, duplicate account, and failed disconnect. Never put the redirect URL into component state, route state, analytics, or a message catalog. Use a deliberate confirmation dialog before disconnect and replace.

- [ ] **Step 5: Add all locale keys and run translation parity.**

Run: `pnpm --filter web messages:parity && pnpm --filter web test src/app/(app)/projects/components/__tests__/project-social-accounts.test.tsx`

Expected: all locales contain the same Project Social accounts keys and lifecycle controls render without a Hermes dependency.

### Task 6: Run the cross-layer regression suite and review the change

**Files:**
- Modify only files required to fix failures from the commands below.
- Review: `CONTEXT.md`, `docs/adr/0018-core-owned-project-social-connections.md`, `docs/plans/2026-09-03-project-social-connections-spec.md`, and this plan if implementation changed an agreed decision.

**Interfaces:**
- Consumes the completed Core API, generated Web client, and Project Settings UI.
- Produces verified behavior and a reviewed working tree ready for the user to decide whether to commit.

- [ ] **Step 1: Run focused Core and Web tests.**

Run: `pnpm --filter core test src/clients/composio.client.test.ts src/services/project-social-connections.service.test.ts src/routes/v1/projects/[id]/social-connections/project-social-connections.routes.test.ts && pnpm --filter web test src/lib/services/__tests__/project.service.test.ts src/lib/actions/project/__tests__/action.test.ts src/app/(app)/projects/components/__tests__/project-social-accounts.test.tsx`

Expected: every selected lifecycle, authorization, and UI test passes.

- [ ] **Step 2: Run static validation after the generated client is current.**

Run: `pnpm --filter core typecheck && pnpm --filter web typecheck && pnpm --filter core lint && pnpm --filter web check`

Expected: no Core or Web diagnostics and no generated-client DTO drift.

- [ ] **Step 3: Inspect the diff for boundary violations.**

```text
Confirm Web has no @sokosumi/database, Composio, X, OAuth token, or Core secret imports.
Confirm no API response or audit DTO contains token, key, hosted OAuth URL, or raw provider payload.
Confirm every social-connection route requires an interactive Workspace human.
```

- [ ] **Step 4: Run the required review pass.**

Run: invoke `/code-review` against the working-tree diff.

Expected: standards and spec review find no unresolved correctness, security, or behavior regressions.

- [ ] **Step 5: Report operational prerequisites separately from application verification.**

```text
Production still requires a customer-owned X app, the exact Composio callback URL,
COMPOSIO_X_AUTH_CONFIG_ID, a scoped COMPOSIO_API_KEY, and a Composio data-retention choice.
```

Do not claim a live X OAuth flow passed until those credentials exist in a non-production environment and an interactive browser check completes.

## Self-Review

- **Spec coverage:** Tasks 1-3 cover persistence, Core authorization, custom Composio OAuth, lifecycle, audit, and OpenAPI. Tasks 4-5 cover generated client, server actions, Project settings, popup handling, and translations. Task 6 covers regression, boundary, and review gates. Posting, media, Calendar, scheduler execution, other providers, and history UI remain excluded.
- **Placeholder scan:** The task descriptions contain no deferred implementation instructions. Deployment prerequisites are intentional out-of-code operational work, not incomplete implementation tasks.
- **Type consistency:** The Project service and Web actions consume Task 3 DTOs. Core routes consume Task 2 service functions. Task 1 persistence owns the fields Task 2 needs for status, provider reference, identity, intent, and audit.
