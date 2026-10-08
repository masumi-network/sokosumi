# CMO runs identity onboarding over a workspaces resource

A person who creates their Sokosumi account from CMO never passes Web's workspace gate, so they reach CMO with no first workspace and cannot use it. CMO therefore runs its own identity onboarding, with its own components and brand, and calls only Core `/v1` with its bearer token ([ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md)). Web's onboarding creates organizations, accepts invitations, and saves names through Better Auth's session client, which a bearer token cannot call, and the workspace facts it reads are spread across `workspace-access`, `personal-workspace`, `organizations`, and `preferred-organization`. Core instead gains one resource, `/v1/users/me/workspaces`, that lists, creates, and selects personal and organization workspaces alike, keyed by the workspace id. This settles the open point in [ADR 0046](0046-first-party-clients-skip-consent.md) about which workspace CMO creates at sign in: none, the person chooses one in onboarding.

## Considered Options

- **Send CMO users to Web's `/setup` and back.** No new UI or routes, but the person leaves the CMO brand on their first visit, and Web's gate has no way back to CMO.
- **Let CMO call Better Auth's session endpoints.** CMO holds no Sokosumi session, only an OAuth token, and ADR 0045 already rejected a bearer plugin or per-origin cookies for CMO.
- **Add only the missing routes next to the existing ones** (`POST /v1/organizations` beside `personal-workspace`). Smallest change, but a client then needs five route families to answer "which workspaces do I have, and which one is active", and personal and organization workspaces keep being created in different places.

## Consequences

- `GET /v1/users/me/workspaces` returns the workspaces the person can act in, which one is preferred, and a count of pending organization invitations. An empty list is the gate: CMO shows identity onboarding, or, when invitations are pending, sends the person to Sokosumi to resolve them.
- `POST /v1/users/me/workspaces` creates `{ kind: "personal" }` or `{ kind: "organization", name, websiteUrl }` and makes the new workspace preferred. An organization is created through Better Auth's server API inside Core, so organization hooks still run; Core generates the slug and stores the website in the organization's `metadata.url`, as Web's wizard does. The website is required for an organization.
- `PUT /v1/users/me/workspaces/preferred` takes a workspace id and replaces `preferred-organization`.
- `DELETE /v1/users/me/workspaces/{workspaceId}` deletes the person's personal workspace and replaces `DELETE personal-workspace`, with the same rules: never the last workspace, never while jobs or tasks use it. An organization workspace is refused: deleting an organization for every member and leaving one are separate decisions.
- The first and last name step stays outside the resource, on `PATCH /v1/users/me`, and CMO asks for it only when sign-up gave no valid first and last name.
- The replaced routes are marked deprecated in the OpenAPI document but stay: shipped Sokosumi Apple builds call `preferred-organization` and the workspace routes. Web moves onto the resource next; the old routes go once no supported client calls them. `preferred-organization` (GET and PUT) is removed now that Web and the Apple app select through `/workspaces` and older Apple builds are no longer supported.
- CMO's organization path asks only for the name and website at first. Web's later steps (site icon as logo, brand guidelines, invite link) and accepting invitations inside CMO follow as separate slices, and read the stored website rather than asking again.
