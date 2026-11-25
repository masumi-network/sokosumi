/**
 * CLI surface fixtures: one per manifest row in apps/core/agent-surface/*.json
 * whose `cli` names a command, keyed by the row's operation.
 * agent-surface.test.ts runs `argv` against a mocked Core and fails unless the
 * run sends that operation. See docs/agents/agent-surface.md.
 */
export interface CliSurfaceFixture {
  readonly argv: readonly string[];
  /** Core's JSON body by request (`"GET /tasks/task-1"`: no `/v1`, no query). Defaults to `CORE`. */
  readonly response?: (request: string) => unknown;
  /** What `--api-key-stdin` reads. */
  readonly stdin?: string;
}

const PERSONAL = "00000000-0000-4000-8000-000000000001";
const TASK = { id: "task-1", identifier: "SOK-1", status: "READY" };
const MEMBER = {
  id: "member-1",
  organizationId: "org-1",
  role: "member",
  seatAssignedAt: null,
  user: { id: "user-2", email: "dev@example.com", name: "Dev" },
};
const page = (data: unknown[]) => ({
  data,
  meta: {
    pagination: {
      cursor: null,
      limit: 50,
      total: data.length,
      nextCursor: null,
    },
  },
});

/** A fake Core with just enough data for every fixture. Unknown requests get an empty list. */
const CORE: Record<string, unknown> = {
  "GET /users/me": {
    data: { id: "user-1", email: "ada@example.com", role: "user,admin" },
  },
  "GET /users/me/organizations": {
    data: [{ id: "org-1", name: "Org", role: "member" }],
  },
  "GET /users/me/workspaces": { data: { workspaces: [] } },
  "POST /users/me/workspaces": { data: { id: PERSONAL } },
  "GET /vendors/me": { data: [{ id: "vendor-1", role: "admin" }] },
  "POST /vendors": {
    data: { id: "vendor-1", name: "Acme", slug: "acme", role: "admin" },
  },
  "GET /coworkers/me": { data: { id: "cw-1", name: "Agent" } },
  "GET /coworkers/cw-1": { data: { id: "cw-1", vendor: { id: "vendor-1" } } },
  "POST /coworkers": {
    data: { id: "cw-1", name: "Agent", vendor: { id: "vendor-1" } },
  },
  "PATCH /coworkers/cw-1": { data: { id: "cw-1", name: "Ada" } },
  "POST /coworkers/cw-1/workspace-access": {
    data: {
      id: "req-1",
      coworkerId: "cw-1",
      workspaceId: "org-1",
      status: "PENDING",
    },
  },
  "POST /coworkers/cw-1/api-keys": {
    data: {
      id: "key-1",
      token: "coworker_fixture_secret",
      name: null,
      expiresAt: null,
    },
  },
  "GET /organizations/org-1/members/me/seat": { data: { assigned: true } },
  "GET /admin/organizations/ws-1": {
    data: {
      organization: { id: "org-1", name: "Org", slug: "ws-1" },
      billingPlan: { mode: "self_serve", plan: "pro", purchasedSeats: 2 },
      seatSummary: {
        purchasedSeats: 2,
        assignedCount: 1,
        unusedSeats: 1,
        memberCount: 1,
      },
    },
  },
  "GET /admin/organizations/ws-1/members": page([]),
  "GET /admin/users": page([MEMBER.user]),
  "POST /admin/organizations/ws-1/members": { data: MEMBER },
  "PUT /admin/organizations/ws-1/members/member-1/seat": {
    data: { memberId: "member-1", seatAssignedAt: "2026-11-23T12:00:00.000Z" },
  },
  "GET /tasks/task-1": { data: TASK },
  "GET /tasks/task-2": { data: { ...TASK, id: "task-2", identifier: "SOK-2" } },
  "POST /tasks": { data: TASK },
  "PATCH /tasks/task-1": { data: TASK },
  "DELETE /tasks/task-1": { data: TASK },
  "POST /tasks/task-1/move": { data: TASK },
  "GET /tasks/task-1/links": {
    data: [{ id: "link-1", relation: "related", peerTask: { id: "task-2" } }],
  },
  "GET /jobs/job-1": { data: { id: "job-1", status: "COMPLETED" } },
  "GET /agents/agent-1/input-schema": { data: { input_data: [] } },
  "POST /agents/agent-1/jobs": { data: { id: "job-1", status: "PENDING" } },
  "POST /admin/evals/runs": {
    data: { id: "run-1", status: "RUNNING", repeats: 1 },
  },
  "GET /admin/evals/runs/run-1": {
    data: {
      run: { id: "run-1", status: "COMPLETED" },
      summary: { open: 0, passed: 0, scored: 0 },
      cases: [],
    },
  },
};

export function core(request: string): unknown {
  return CORE[request] ?? { data: [] };
}

const API = ["--api-url", "https://fixture.invalid"];
const ADMIN = ["--preprod", "admin"];
const TASK_ARGS = (command: string, ...rest: string[]) => [
  ...API,
  "tasks",
  command,
  "task-1",
  ...rest,
  "--json",
];
/** A Studio start always carries the caller's idempotencyKey. */
const studioStart = (command: string, body: Record<string, unknown>) => ({
  argv: [
    ...API,
    "projects",
    command,
    "project-1",
    "--organization-slug",
    "acme",
    "--input-json",
    JSON.stringify({ ...body, idempotencyKey: "intent-0001" }),
  ],
});
const AGENTS_HIRE = {
  argv: [...API, "agents", "hire", "agent-1", "--input-json", "{}", "--json"],
};
const ADD_MEMBER = {
  argv: [
    ...ADMIN,
    "add-member",
    "ws-1",
    "--email",
    "dev@example.com",
    "--json",
  ],
};
const ADMIN_MEMBERS = { argv: [...ADMIN, "members", "ws-1", "--json"] };
const COWORKER_CONNECT = {
  argv: [
    "--preprod",
    "coworkers",
    "connect",
    "cw-1",
    "--vendor-id",
    "vendor-1",
    "--workspace-id",
    "org-1",
    "--json",
  ],
};
const EVALS_RUN = {
  argv: [...API, "evals", "run", "--wait", "--tick", "--json"],
};
const JOBS_INPUT = {
  argv: [
    ...API,
    "jobs",
    "input",
    "job-1",
    "--event-id",
    "ev-1",
    "--input-json",
    '{"a":1}',
    "--json",
  ],
};

export const CLI_SURFACE_FIXTURES: Record<string, CliSurfaceFixture> = {
  "GET /admin/organizations/{slug}": ADMIN_MEMBERS,
  "GET /admin/organizations/{slug}/members": ADMIN_MEMBERS,
  "GET /admin/users": ADD_MEMBER,
  "POST /admin/organizations/{slug}/members": ADD_MEMBER,
  "PUT /admin/organizations/{slug}/members/{memberId}/seat": {
    argv: [
      ...ADMIN,
      "assign-seat",
      "ws-1",
      "--email",
      "dev@example.com",
      "--json",
    ],
    response: (request) =>
      request === "GET /admin/organizations/ws-1/members"
        ? page([MEMBER])
        : core(request),
  },
  "GET /admin/evals/cases": { argv: [...API, "evals", "cases", "--json"] },
  "GET /admin/evals/runs": { argv: [...API, "evals", "list", "--json"] },
  "GET /admin/evals/runs/{id}": {
    argv: [...API, "evals", "show", "run-1", "--json"],
  },
  "POST /admin/evals/runs": EVALS_RUN,
  "POST /admin/evals/tick": EVALS_RUN,
  "GET /agents": { argv: [...API, "agents", "list", "--json"] },
  "GET /agents/{id}/input-schema": AGENTS_HIRE,
  "POST /agents/{id}/jobs": AGENTS_HIRE,
  "GET /agents/{id}": { argv: [...API, "agents", "get", "agent-1"] },
  "GET /agents/{id}/jobs": {
    argv: [...API, "agents", "jobs", "agent-1", "--query", "scope=workspace"],
  },
  "GET /agents/{id}/reviews": {
    argv: [...API, "agents", "reviews", "agent-1", "--query", "limit=5"],
  },
  "GET /agents/{id}/reviews/me": {
    argv: [...API, "agents", "my-review", "agent-1"],
  },
  "GET /agents/{id}/ratings/eligibility": {
    argv: [...API, "agents", "rating-eligibility", "agent-1"],
  },
  "GET /users/{id}": { argv: [...API, "auth", "whoami", "--json"] },
  "GET /coworkers": { argv: [...API, "coworkers", "list", "--json"] },
  "GET /coworkers/me": { argv: [...API, "coworkers", "me", "--json"] },
  "POST /coworkers": {
    argv: [
      "--preprod",
      "coworkers",
      "register",
      "--vendor-id",
      "vendor-1",
      "--name",
      "Agent",
      "--workspace-id",
      "org-1",
      "--json",
    ],
  },
  "GET /coworkers/{id}": COWORKER_CONNECT,
  "POST /coworkers/{id}/workspace-access": COWORKER_CONNECT,
  "PATCH /coworkers/{id}": {
    argv: [...API, "coworkers", "update", "cw-1", "--name", "Ada", "--json"],
  },
  "GET /coworkers/{id}/api-keys": {
    argv: [...API, "coworkers", "list-api-keys", "cw-1"],
  },
  "POST /coworkers/{id}/api-keys": {
    argv: ["--preprod", "coworkers", "api-key", "cw-1", "--json"],
  },
  "DELETE /coworkers/{id}/api-keys/{keyId}": {
    argv: [...API, "coworkers", "revoke-api-key", "cw-1", "key-1"],
  },
  "GET /jobs": { argv: [...API, "jobs", "list", "--json"] },
  "GET /jobs/{id}": { argv: [...API, "jobs", "get", "job-1", "--json"] },
  "GET /jobs/{id}/input-request": {
    argv: [...API, "jobs", "get", "job-1", "--details", "--json"],
  },
  "POST /jobs/{id}/inputs": JOBS_INPUT,
  "GET /jobs/{id}/events": { argv: [...API, "jobs", "events", "job-1"] },
  "GET /jobs/{id}/files": { argv: [...API, "jobs", "files", "job-1"] },
  "GET /jobs/{id}/links": { argv: [...API, "jobs", "links", "job-1"] },
  "PATCH /jobs/{id}": {
    argv: [
      ...API,
      "jobs",
      "update",
      "job-1",
      "--input-json",
      '{"name":"Brief"}',
    ],
  },
  "PUT /jobs/{id}/workspace": {
    argv: [
      ...API,
      "jobs",
      "move",
      "job-1",
      "--input-json",
      '{"organizationId":null}',
    ],
  },
  "DELETE /jobs/{id}/share": { argv: [...API, "jobs", "unshare", "job-1"] },
  "GET /tasks/{id}/receipt": {
    argv: [
      "runtime",
      "receipt",
      "task-1",
      "--coworker-id",
      "cw-1",
      "--api-key-stdin",
      "--json",
    ],
    response: () => ({ data: { settled: false, txHash: null } }),
    stdin: "coworker_fixture_key",
  },
  "GET /tasks": { argv: [...API, "tasks", "list", "--json"] },
  "POST /tasks": {
    argv: [...API, "tasks", "create", "--description", "Write it", "--json"],
  },
  "GET /tasks/{id}": { argv: TASK_ARGS("get") },
  "PATCH /tasks/{id}": { argv: TASK_ARGS("update", "--name", "Renamed") },
  "DELETE /tasks/{id}": { argv: TASK_ARGS("archive") },
  "GET /tasks/{id}/events": { argv: TASK_ARGS("events") },
  "POST /tasks/{id}/events": {
    argv: TASK_ARGS("comment", "--comment", "Done"),
  },
  "GET /tasks/{id}/jobs": { argv: TASK_ARGS("jobs") },
  "GET /tasks/{id}/links": { argv: TASK_ARGS("links") },
  "POST /tasks/{id}/links": {
    argv: TASK_ARGS("link", "--to", "task-2", "--relation", "related"),
  },
  "DELETE /tasks/{id}/links/{linkId}": {
    argv: TASK_ARGS("unlink", "--to", "task-2"),
  },
  "POST /tasks/{id}/move": { argv: TASK_ARGS("move", "--first") },
  "GET /vendors/me": { argv: [...API, "vendors", "me", "--json"] },
  "POST /vendors": {
    argv: [
      ...API,
      "vendors",
      "create",
      "--name",
      "Acme",
      "--slug",
      "acme",
      "--json",
    ],
  },
  // SOKD-372: coworkers, vendors and developer.
  "GET /coworkers/me/events": { argv: [...API, "coworkers", "events"] },
  "POST /coworkers/me/usage": {
    argv: [
      ...API,
      "coworkers",
      "report-usage",
      "--input-json",
      '{"userId":"user-1","organizationId":null,"idempotencyKey":"u-1"}',
    ],
  },
  "DELETE /coworkers/{id}": { argv: [...API, "coworkers", "archive", "cw-1"] },
  "POST /coworkers/{id}/unarchive": {
    argv: [...API, "coworkers", "unarchive", "cw-1", "--input-json", "{}"],
  },
  "PATCH /coworkers/{id}/whitelist": {
    argv: [
      ...API,
      "coworkers",
      "whitelist",
      "cw-1",
      "--input-json",
      '{"isWhitelisted":true}',
    ],
  },
  "DELETE /coworkers/{id}/image": {
    argv: [...API, "coworkers", "remove-image", "cw-1"],
  },
  "PATCH /coworkers/{id}/api-keys/{keyId}": {
    argv: [
      ...API,
      "coworkers",
      "update-api-key",
      "cw-1",
      "key-1",
      "--input-json",
      '{"name":"Runtime"}',
    ],
  },
  "GET /coworkers/{id}/workspace-access": {
    argv: [...API, "coworkers", "list-access", "cw-1"],
  },
  "POST /coworkers/{id}/workspace-access/revoke": {
    argv: [
      ...API,
      "coworkers",
      "revoke-access",
      "cw-1",
      "--input-json",
      '{"organizationSlug":"acme"}',
    ],
  },
  "GET /vendors": { argv: [...API, "vendors", "list"] },
  "PATCH /vendors/{id}": {
    argv: [
      ...API,
      "vendors",
      "update",
      "vendor-1",
      "--input-json",
      '{"name":"Acme"}',
    ],
  },
  "POST /vendors/{id}/files": {
    argv: [
      ...API,
      "vendors",
      "logo-upload",
      "vendor-1",
      "--input-json",
      '{"filename":"logo.png","contentType":"image/png","size":1024}',
    ],
  },
  "POST /vendors/{id}/files/cleanup": {
    argv: [
      ...API,
      "vendors",
      "logo-cleanup",
      "vendor-1",
      "--input-json",
      '{"url":"https://blob.example/vendors/vendor-1/logos/old.png"}',
    ],
  },
  "GET /vendors/{id}/members": {
    argv: [...API, "vendors", "members", "vendor-1"],
  },
  "PATCH /vendors/{id}/members/{userId}": {
    argv: [
      ...API,
      "vendors",
      "update-member",
      "vendor-1",
      "user-2",
      "--input-json",
      '{"role":"admin"}',
    ],
  },
  "DELETE /vendors/{id}/members/{userId}": {
    argv: [...API, "vendors", "remove-member", "vendor-1", "user-2"],
  },
  "GET /vendors/{id}/invites": {
    argv: [...API, "vendors", "invites", "vendor-1"],
  },
  "POST /vendors/{id}/invites": {
    argv: [
      ...API,
      "vendors",
      "invite",
      "vendor-1",
      "--input-json",
      '{"email":"dev@example.com"}',
    ],
  },
  "DELETE /vendors/{id}/invites/{inviteId}": {
    argv: [...API, "vendors", "revoke-invite", "vendor-1", "invite-1"],
  },
  "GET /vendors/invites": { argv: [...API, "vendors", "my-invites"] },
  "POST /vendors/invites/{inviteId}/accept": {
    argv: [
      ...API,
      "vendors",
      "accept-invite",
      "invite-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /vendors/invites/{inviteId}/decline": {
    argv: [
      ...API,
      "vendors",
      "decline-invite",
      "invite-1",
      "--input-json",
      "{}",
    ],
  },
  "GET /vendors/{id}/coworkers/{coworkerId}/assignments": {
    argv: [...API, "vendors", "assignments", "vendor-1", "cw-1"],
  },
  "PUT /vendors/{id}/coworkers/{coworkerId}/assignments": {
    argv: [
      ...API,
      "vendors",
      "assign",
      "vendor-1",
      "cw-1",
      "--input-json",
      '{"userId":"user-2"}',
    ],
  },
  "DELETE /vendors/{id}/coworkers/{coworkerId}/assignments/{userId}": {
    argv: [...API, "vendors", "unassign", "vendor-1", "cw-1", "user-2"],
  },
  "GET /developer/tasks": { argv: [...API, "developer", "tasks"] },
  "GET /developer/tasks/{id}": {
    argv: [...API, "developer", "task", "task-1"],
  },
  "GET /users/{id}/organizations": {
    argv: [...API, "workspaces", "list", "--json"],
  },
  "GET /users/{id}/workspaces": {
    argv: [...API, "workspaces", "list", "--personal", "--json"],
  },
  "GET /organizations/{id}/members/me/seat": {
    argv: [...API, "workspaces", "check", "org-1", "--json"],
  },
  // SOKD-378: ads, image-studio, social and calendar reads.
  "GET /image-studio/catalog": { argv: [...API, "image-studio", "catalog"] },
  "GET /image-studio/state": { argv: [...API, "image-studio", "state"] },
  "GET /image-studio/recent-projects": {
    argv: [...API, "image-studio", "recent-projects"],
  },
  "GET /projects/{id}/ads/accounts": {
    argv: [...API, "projects", "ads-accounts", "p-1"],
  },
  "GET /projects/{id}/ads/accounts/{accountId}/campaigns": {
    argv: [...API, "projects", "ads-campaigns", "p-1", "acc-1"],
  },
  "GET /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}": {
    argv: [...API, "projects", "ads-campaign", "p-1", "acc-1", "42"],
  },
  "GET /projects/{id}/ads/accounts/{accountId}/targeting/locations": {
    argv: [
      ...API,
      "projects",
      "ads-locations",
      "p-1",
      "acc-1",
      "--query",
      "q=Berlin",
    ],
  },
  "GET /projects/{id}/ads/accounts/{accountId}/targeting/languages": {
    argv: [...API, "projects", "ads-languages", "p-1", "acc-1"],
  },
  "GET /projects/{id}/ads/market": {
    argv: [...API, "projects", "ads-market", "p-1"],
  },
  "GET /projects/{id}/image-studio": {
    argv: [...API, "projects", "image-studio", "p-1"],
  },
  "GET /projects/{id}/image-studio/batches/{batchId}/assets": {
    argv: [...API, "projects", "image-studio-batch", "p-1", "b-1"],
  },
  "GET /projects/{id}/image-studio/batches/{batchId}/compare": {
    argv: [...API, "projects", "image-studio-compare", "p-1", "b-1"],
  },
  "GET /projects/{id}/image-studio/model-scoreboard": {
    argv: [...API, "projects", "image-studio-scoreboard", "p-1"],
  },
  "GET /projects/{id}/image-studio/brand-kit": {
    argv: [...API, "projects", "image-studio-brand-kit", "p-1"],
  },
  "GET /projects/{id}/image-studio/brand-kit/website-copy": {
    argv: [...API, "projects", "image-studio-website-copy", "p-1"],
  },
  "GET /projects/{id}/image-studio/website-draft": {
    argv: [...API, "projects", "image-studio-website-draft", "p-1"],
  },
  "GET /projects/{id}/image-studio/products": {
    argv: [...API, "projects", "image-studio-products", "p-1"],
  },
  "GET /projects/{id}/image-studio/talking-videos": {
    argv: [...API, "projects", "image-studio-talking-videos", "p-1"],
  },
  "GET /projects/{id}/social-connections": {
    argv: [...API, "projects", "social-connections", "p-1"],
  },
  "GET /projects/{id}/social-connections/{connectionId}/subscription": {
    argv: [...API, "projects", "social-connection-subscription", "p-1", "c-1"],
  },
  "GET /projects/{id}/social-connections/{connectionId}/tiktok-creator": {
    argv: [
      ...API,
      "projects",
      "social-connection-tiktok-creator",
      "p-1",
      "c-1",
    ],
  },
  "GET /projects/{id}/social-connections/{connectionId}/suggested-times": {
    argv: [
      ...API,
      "projects",
      "social-connection-suggested-times",
      "p-1",
      "c-1",
      "--query",
      "timezone=Europe/Berlin",
    ],
  },
  "GET /projects/{id}/social-connections/statistics": {
    argv: [...API, "projects", "social-statistics", "p-1"],
  },
  "GET /projects/{id}/social-posts": {
    argv: [...API, "projects", "social-posts", "p-1"],
  },
  "GET /projects/{id}/social-posts/{postId}": {
    argv: [...API, "projects", "social-post", "p-1", "sp-1"],
  },
  "GET /projects/{id}/social-posts/statistics": {
    argv: [...API, "projects", "social-posts-statistics", "p-1"],
  },
  "GET /projects/{id}/social-queue-slots": {
    argv: [...API, "projects", "social-queue-slots", "p-1"],
  },
  "GET /projects/{id}/calendar": {
    argv: [
      ...API,
      "projects",
      "calendar",
      "p-1",
      "--query",
      "from=2026-11-01T00:00:00.000Z",
      "--query",
      "to=2026-12-01T00:00:00.000Z",
    ],
  },
  "GET /workspaces/calendar": {
    argv: [
      ...API,
      "workspaces",
      "calendar",
      "--query",
      "from=2026-11-01T00:00:00.000Z",
      "--query",
      "to=2026-12-01T00:00:00.000Z",
    ],
  },
  "GET /workspaces/calendar/sources": {
    argv: [...API, "workspaces", "calendar-sources"],
  },
  "GET /workspaces/social-posts": {
    argv: [...API, "workspaces", "social-posts"],
  },
  "GET /workspaces/{id}/social-connections/statistics": {
    argv: [...API, "workspaces", "social-statistics", "ws-1"],
  },
  // SOKD-371: users, organizations and workspaces.
  "GET /users/registered": {
    argv: [...API, "users", "registered", "--query", "email=ada@example.com"],
  },
  "PATCH /users/{id}": {
    argv: [
      ...API,
      "users",
      "update",
      "me",
      "--input-json",
      '{"firstName":"Ada","lastName":"Lovelace"}',
    ],
  },
  "GET /users/{id}/credits": { argv: [...API, "workspaces", "credits", "me"] },
  "PUT /users/{id}/design-md": {
    argv: [
      ...API,
      "users",
      "set-design-md",
      "me",
      "--input-json",
      '{"content":"# Brand","extractionId":null}',
    ],
  },
  "GET /users/{id}/preferences": {
    argv: [...API, "users", "preferences", "me"],
  },
  "PATCH /users/{id}/preferences": {
    argv: [
      ...API,
      "users",
      "update-preferences",
      "me",
      "--input-json",
      '{"marketingOptIn":false}',
    ],
  },
  "GET /users/{id}/files": { argv: [...API, "users", "files", "me"] },
  "POST /users/{id}/files": {
    argv: [
      ...API,
      "users",
      "file-upload",
      "me",
      "--input-json",
      '{"filename":"a.png","contentType":"image/png","size":10}',
    ],
  },
  "GET /users/{id}/coworker-access": {
    argv: [...API, "users", "coworker-access", "me"],
  },
  "POST /users/{id}/coworker-access/{accessId}/deny": {
    argv: [
      ...API,
      "users",
      "deny-coworker-access",
      "me",
      "access-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /users/{id}/coworker-access/{accessId}/revoke": {
    argv: [
      ...API,
      "users",
      "revoke-coworker-access",
      "me",
      "access-1",
      "--input-json",
      "{}",
    ],
  },
  "GET /users/{id}/vendor-grants": {
    argv: [...API, "users", "vendor-grants", "me"],
  },
  "POST /users/{id}/vendor-grants/{grantId}/deny": {
    argv: [
      ...API,
      "users",
      "deny-vendor-grant",
      "me",
      "grant-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /users/{id}/vendor-grants/{grantId}/revoke": {
    argv: [
      ...API,
      "users",
      "revoke-vendor-grant",
      "me",
      "grant-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /users/{id}/workspaces": {
    argv: [
      ...API,
      "workspaces",
      "create",
      "me",
      "--input-json",
      '{"kind":"personal"}',
    ],
  },
  "GET /users/{id}/workspaces/preferred": {
    argv: [...API, "users", "preferred-workspace", "me"],
  },
  "PUT /users/{id}/workspaces/preferred": {
    argv: [
      ...API,
      "users",
      "set-preferred-workspace",
      "me",
      "--input-json",
      '{"workspaceId":"ws-1"}',
    ],
  },
  "DELETE /users/{id}/workspaces/{workspaceId}": {
    argv: [...API, "users", "delete-workspace", "me", "ws-1"],
  },
  "GET /users/{id}/members": {
    argv: [...API, "organizations", "memberships", "me"],
  },
  "GET /users/{id}/organizations/{organizationId}/credits": {
    argv: [...API, "organizations", "credits", "me", "org-1"],
  },
  "GET /users/{id}/organizations/{organizationId}/member": {
    argv: [...API, "organizations", "membership", "me", "org-1"],
  },
  "GET /users/{id}/pending-organization-invitations": {
    argv: [...API, "organizations", "pending-invitations", "me"],
  },
  "GET /organizations/slug/{slug}": {
    argv: [...API, "organizations", "get-by-slug", "acme"],
  },
  "GET /organizations/{id}": {
    argv: [...API, "organizations", "get", "org-1"],
  },
  "GET /organizations/{id}/members": {
    argv: [...API, "organizations", "members", "org-1"],
  },
  "PUT /organizations/{id}/members/{memberId}/seat": {
    argv: [
      ...API,
      "organizations",
      "assign-seat",
      "org-1",
      "member-1",
      "--input-json",
      "{}",
    ],
  },
  "DELETE /organizations/{id}/members/{memberId}/seat": {
    argv: [...API, "organizations", "unassign-seat", "org-1", "member-1"],
  },
  "GET /organizations/{id}/invitations": {
    argv: [...API, "organizations", "invitations", "org-1"],
  },
  "GET /organizations/{id}/invite-links": {
    argv: [...API, "organizations", "invite-links", "org-1"],
  },
  "POST /organizations/{id}/invite-links": {
    argv: [
      ...API,
      "organizations",
      "create-invite-link",
      "org-1",
      "--input-json",
      '{"expiresInDays":7}',
    ],
  },
  "DELETE /organizations/{id}/invite-links/{token}": {
    argv: [
      ...API,
      "organizations",
      "revoke-invite-link",
      "org-1",
      "link-token",
    ],
  },
  "GET /organizations/{id}/coworker-access": {
    argv: [...API, "organizations", "coworker-access", "org-1"],
  },
  "POST /organizations/{id}/coworker-access/{accessId}/deny": {
    argv: [
      ...API,
      "organizations",
      "deny-coworker-access",
      "org-1",
      "access-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /organizations/{id}/coworker-access/{accessId}/revoke": {
    argv: [
      ...API,
      "organizations",
      "revoke-coworker-access",
      "org-1",
      "access-1",
      "--input-json",
      "{}",
    ],
  },
  "GET /organizations/{id}/vendor-grants": {
    argv: [...API, "organizations", "vendor-grants", "org-1"],
  },
  "POST /organizations/{id}/vendor-grants/{grantId}/deny": {
    argv: [
      ...API,
      "organizations",
      "deny-vendor-grant",
      "org-1",
      "grant-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /organizations/{id}/vendor-grants/{grantId}/revoke": {
    argv: [
      ...API,
      "organizations",
      "revoke-vendor-grant",
      "org-1",
      "grant-1",
      "--input-json",
      "{}",
    ],
  },
  "PUT /organizations/{id}/design-md": {
    argv: [
      ...API,
      "organizations",
      "set-design-md",
      "org-1",
      "--input-json",
      '{"content":"# Brand","extractionId":null}',
    ],
  },
  "GET /organizations/{id}/standup": {
    argv: [...API, "organizations", "standup", "org-1"],
  },
  "PUT /organizations/{id}/standup": {
    argv: [
      ...API,
      "organizations",
      "set-standup",
      "org-1",
      "--input-json",
      '{"enabled":true}',
    ],
  },
  "GET /workspaces/{id}": { argv: [...API, "workspaces", "get", "ws-1"] },
  "GET /workspaces/{id}/ad-data-consent": {
    argv: [...API, "workspaces", "ad-data-consent", "ws-1"],
  },
  "PUT /workspaces/{id}/ad-data-consent": {
    argv: [
      ...API,
      "workspaces",
      "set-ad-data-consent",
      "ws-1",
      "--input-json",
      '{"shareForImprovement":false,"allowTraining":false}',
    ],
  },
  "POST /workspaces/{id}/calendar/identity-labels": {
    argv: [
      ...API,
      "workspaces",
      "calendar-labels",
      "ws-1",
      "--input-json",
      '{"refs":["ref-1"]}',
    ],
  },
  "GET /workspaces/design-md": { argv: [...API, "workspaces", "design-md"] },
  "POST /workspaces/design-md/adhoc": {
    argv: [
      ...API,
      "workspaces",
      "adhoc-design-md",
      "--input-json",
      '{"content":"# Brand","extractionId":null}',
    ],
  },
  // SOKD-369: schedules, files, follow, participants, workspace, summary, due dates.
  "GET /tasks/summary": {
    argv: [...API, "tasks", "summary", "--query", "scope=workspace"],
  },
  "GET /tasks/view": { argv: [...API, "tasks", "view"] },
  "PUT /tasks/view": {
    argv: [...API, "tasks", "set-view", "--input-json", '{"query":""}'],
  },
  "POST /tasks/due-dates/move-overdue": {
    argv: [
      ...API,
      "tasks",
      "move-overdue",
      "--input-json",
      '{"today":"2026-11-24","to":"2026-11-25"}',
    ],
  },
  "POST /tasks/due-dates/undo": {
    argv: [...API, "tasks", "undo-move-overdue", "--input-json", "{}"],
  },
  "GET /tasks/schedules": { argv: [...API, "tasks", "list-schedules"] },
  "POST /tasks/schedules": {
    argv: [
      ...API,
      "tasks",
      "create-schedule",
      "--input-json",
      '{"name":"Weekly report","rule":{"expr":"0 9 * * 1"}}',
    ],
  },
  "GET /tasks/schedules/assignees": {
    argv: [...API, "tasks", "schedule-assignees"],
  },
  "GET /tasks/schedules/{id}": {
    argv: [...API, "tasks", "get-schedule", "sched-1"],
  },
  "PATCH /tasks/schedules/{id}": {
    argv: [
      ...API,
      "tasks",
      "update-schedule",
      "sched-1",
      "--input-json",
      '{"expectedRevision":3}',
    ],
  },
  "DELETE /tasks/schedules/{id}": {
    argv: [...API, "tasks", "delete-schedule", "sched-1"],
  },
  "POST /tasks/schedules/{id}/pause": {
    argv: [...API, "tasks", "pause-schedule", "sched-1"],
  },
  "POST /tasks/schedules/{id}/resume": {
    argv: [...API, "tasks", "resume-schedule", "sched-1"],
  },
  "POST /tasks/schedules/{id}/end": {
    argv: [...API, "tasks", "end-schedule", "sched-1"],
  },
  "GET /tasks/schedules/{id}/runs": {
    argv: [...API, "tasks", "schedule-runs", "sched-1"],
  },
  "POST /tasks/schedules/{id}/runs": {
    argv: [
      ...API,
      "tasks",
      "run-schedule",
      "sched-1",
      "--input-json",
      '{"expectedRevision":3}',
    ],
  },
  "PATCH /tasks/schedules/{id}/runs/{runId}": {
    argv: [
      ...API,
      "tasks",
      "update-schedule-run",
      "sched-1",
      "run-1",
      "--input-json",
      '{"expectedRevision":3,"action":"skip"}',
    ],
  },
  "PATCH /tasks/{id}/links/{linkId}": {
    argv: [
      ...API,
      "tasks",
      "update-link",
      "task-1",
      "link-1",
      "--input-json",
      '{"note":"Waits on the copy."}',
    ],
  },
  "POST /tasks/{id}/participants": {
    argv: [...API, "tasks", "join", "task-1"],
  },
  "DELETE /tasks/{id}/participants/{userId}": {
    argv: [...API, "tasks", "leave", "task-1", "user-1"],
  },
  "POST /tasks/{id}/follow": { argv: [...API, "tasks", "follow", "task-1"] },
  "DELETE /tasks/{id}/follow": {
    argv: [...API, "tasks", "unfollow", "task-1"],
  },
  "POST /tasks/{id}/chat-messages": {
    argv: [
      ...API,
      "tasks",
      "send-to-chat",
      "task-1",
      "--input-json",
      '{"roomId":"room-1","clientMessageId":"msg-1"}',
    ],
  },
  "GET /tasks/{id}/workspace": {
    argv: [...API, "tasks", "workspace", "task-1"],
  },
  "PUT /tasks/{id}/workspace": {
    argv: [
      ...API,
      "tasks",
      "set-workspace",
      "task-1",
      "--input-json",
      '{"organizationId":"org-1"}',
    ],
  },
  "POST /tasks/{id}/restore": { argv: [...API, "tasks", "restore", "task-1"] },
  "GET /tasks/{id}/files": { argv: [...API, "tasks", "files", "task-1"] },
  "POST /tasks/{id}/files": {
    argv: [
      ...API,
      "tasks",
      "upload-url",
      "task-1",
      "--input-json",
      '{"filename":"brief.pdf","contentType":"application/pdf","size":2048}',
    ],
  },
  // SOKD-370: categories, history, transactions and notifications.
  "GET /categories": { argv: [...API, "categories", "list"] },
  "GET /history": {
    argv: [...API, "history", "list", "--query", "types=job"],
  },
  "GET /transactions": {
    argv: [...API, "transactions", "list", "--organization-slug", "acme"],
  },
  "GET /transactions/daily": {
    argv: [
      ...API,
      "transactions",
      "daily",
      "--query",
      "from=2026-11-01",
      "--query",
      "to=2026-11-24",
    ],
  },
  "GET /transactions/total": {
    argv: [...API, "transactions", "total", "--query", "taskId=task-1"],
  },
  "GET /notifications": {
    argv: [...API, "notifications", "list", "--query", "isRead=false"],
  },
  "GET /notifications/counts": { argv: [...API, "notifications", "counts"] },
  "PATCH /notifications/{id}/read": {
    argv: [...API, "notifications", "read", "n-1"],
  },
  "PATCH /notifications/{id}/unread": {
    argv: [...API, "notifications", "unread", "n-1"],
  },
  "PATCH /notifications/read": {
    argv: [
      ...API,
      "notifications",
      "read-many",
      "--input-json",
      '{"ids":["n-1"]}',
    ],
  },
  "PATCH /notifications/read-all": {
    argv: [...API, "notifications", "read-all"],
  },
  // SOKD-385: Image Studio generations and cancel.
  "POST /projects/{id}/image-studio/jobs": studioStart(
    "image-studio-generate",
    {
      prompt: "A red vase",
    },
  ),
  "POST /projects/{id}/image-studio/video-jobs": studioStart(
    "image-studio-video",
    { prompt: "A red vase turning" },
  ),
  "POST /projects/{id}/image-studio/short-video-jobs": studioStart(
    "image-studio-short-video",
    { format: "voiceover", script: "Meet the vase." },
  ),
  "POST /projects/{id}/image-studio/talking-video-jobs": studioStart(
    "image-studio-talking-video",
    { script: "Meet the vase.", presenter: { kind: "stock", id: "ada" } },
  ),
  "POST /projects/{id}/image-studio/jobs/{jobId}/cancel": {
    argv: [...API, "projects", "image-studio-cancel", "project-1", "job-1"],
  },
  // SOKD-394: edits that spend no credits and publish nothing.
  "PUT /projects/{id}/ads/market": {
    argv: [
      ...API,
      "projects",
      "ads-market-update",
      "p-1",
      "--input-json",
      '{"keywords":["lamp"],"countryCode":"DE","languageCode":"de"}',
    ],
  },
  "PUT /projects/{id}/image-studio/brand-kit": {
    argv: [
      ...API,
      "projects",
      "image-studio-brand-kit-update",
      "p-1",
      "--input-json",
      '{"copy":{"summary":"Lamps","tone":"Calm","audience":[],"approvedLines":[]},"version":null}',
    ],
  },
  "PUT /projects/{id}/image-studio/brand-kit/look": {
    argv: [
      ...API,
      "projects",
      "image-studio-brand-look-update",
      "p-1",
      "--input-json",
      '{"look":null,"lookRevision":0}',
    ],
  },
  "POST /projects/{id}/image-studio/website-draft": {
    argv: [...API, "projects", "image-studio-website-research", "p-1"],
  },
  "POST /projects/{id}/image-studio/brand-kit/logo/website": {
    argv: [...API, "projects", "image-studio-website-logo", "p-1"],
  },
  "PUT /projects/{id}/image-studio/products": {
    argv: [
      ...API,
      "projects",
      "image-studio-products-update",
      "p-1",
      "--input-json",
      '{"products":[],"revision":0}',
    ],
  },
  "POST /projects/{id}/image-studio/products/import": {
    argv: [
      ...API,
      "projects",
      "image-studio-products-import",
      "p-1",
      "--input-json",
      '{"url":"https://example.com"}',
    ],
  },
  "POST /projects/{id}/image-studio/products/photo": {
    argv: [
      ...API,
      "projects",
      "image-studio-product-photo",
      "p-1",
      "--input-json",
      '{"name":"Lamp","imageUrl":"https://example.com/lamp.png"}',
    ],
  },
  "POST /projects/{id}/image-studio/talking-video-scripts": {
    argv: [
      ...API,
      "projects",
      "image-studio-talking-video-scripts",
      "p-1",
      "--input-json",
      '{"topic":"Spring sale"}',
    ],
  },
  "PUT /projects/{id}/image-studio/assets/{assetId}/headline": {
    argv: [
      ...API,
      "projects",
      "image-studio-asset-headline",
      "p-1",
      "a-1",
      "--input-json",
      '{"text":"Hello"}',
    ],
  },
  "POST /projects/{id}/image-studio/assets/{assetId}/caption": {
    argv: [...API, "projects", "image-studio-asset-caption", "p-1", "a-1"],
  },
  // SOKD-383: an agent drafts, plans and cancels Social posts and cancels newsletters.
  "POST /projects/{id}/social-posts": {
    argv: [
      ...API,
      "projects",
      "social-post-create",
      "p-1",
      "--input-json",
      '{"text":"Hello"}',
    ],
  },
  "PATCH /projects/{id}/social-posts/{postId}": {
    argv: [
      ...API,
      "projects",
      "social-post-update",
      "p-1",
      "post-1",
      "--input-json",
      '{"revision":0,"text":"Hi"}',
    ],
  },
  "POST /projects/{id}/social-posts/{postId}/schedule": {
    argv: [
      ...API,
      "projects",
      "social-post-schedule",
      "p-1",
      "post-1",
      "--input-json",
      '{"revision":0,"scheduledAt":"2030-01-01T10:00:00Z"}',
    ],
  },
  "POST /projects/{id}/social-posts/{postId}/queue": {
    argv: [
      ...API,
      "projects",
      "social-post-queue",
      "p-1",
      "post-1",
      "--input-json",
      '{"revision":0}',
    ],
  },
  "POST /projects/{id}/social-posts/{postId}/cancel": {
    argv: [
      ...API,
      "projects",
      "social-post-cancel",
      "p-1",
      "post-1",
      "--input-json",
      '{"revision":0}',
    ],
  },
  "POST /projects/{id}/social-posts/{postId}/duplicate": {
    argv: [
      ...API,
      "projects",
      "social-post-duplicate",
      "p-1",
      "post-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /projects/{id}/social-posts/{postId}/statistics/refresh": {
    argv: [
      ...API,
      "projects",
      "social-post-statistics-refresh",
      "p-1",
      "post-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /projects/{id}/social-account-posts/{accountPostId}/recycle": {
    argv: [
      ...API,
      "projects",
      "social-account-post-recycle",
      "p-1",
      "ap-1",
      "--input-json",
      "{}",
    ],
  },
  "PUT /projects/{id}/social-queue-slots": {
    argv: [
      ...API,
      "projects",
      "social-queue-slots-update",
      "p-1",
      "--input-json",
      '{"timezone":"UTC","slots":[]}',
    ],
  },
  "POST /projects/{id}/social-connections/{connectionId}/statistics/refresh": {
    argv: [
      ...API,
      "projects",
      "social-connection-statistics-refresh",
      "p-1",
      "c-1",
      "--input-json",
      "{}",
    ],
  },
  "POST /projects/{id}/newsletter/issues/{issueId}/cancel": {
    argv: [
      ...API,
      "projects",
      "newsletter-issue-cancel",
      "p-1",
      "issue-1",
      "--input-json",
      '{"revision":0}',
    ],
  },
  // SOKD-373: projects and newsletter.
  "GET /projects": {
    argv: [...API, "projects", "list", "--query", "state=open"],
  },
  "POST /projects": {
    argv: [...API, "projects", "create", "--input-json", '{"name":"Launch"}'],
  },
  "GET /projects/stats": {
    argv: [...API, "projects", "stats"],
  },
  "GET /projects/activity": {
    argv: [...API, "projects", "activity", "--query", "limit=10"],
  },
  "GET /projects/starred": {
    argv: [...API, "projects", "starred"],
  },
  "GET /projects/{id}": {
    argv: [...API, "projects", "get", "p-1"],
  },
  "PATCH /projects/{id}": {
    argv: [
      ...API,
      "projects",
      "update",
      "p-1",
      "--input-json",
      '{"briefing":"We sell running shoes."}',
    ],
  },
  "POST /projects/{id}/star": {
    argv: [...API, "projects", "star", "p-1"],
  },
  "DELETE /projects/{id}/star": {
    argv: [...API, "projects", "unstar", "p-1"],
  },
  "GET /projects/{id}/hide": {
    argv: [...API, "projects", "hidden", "p-1"],
  },
  "POST /projects/{id}/hide": {
    argv: [...API, "projects", "hide", "p-1"],
  },
  "DELETE /projects/{id}/hide": {
    argv: [...API, "projects", "unhide", "p-1"],
  },
  "POST /projects/{id}/jobs": {
    argv: [
      ...API,
      "projects",
      "add-job",
      "p-1",
      "--input-json",
      '{"jobId":"job-1"}',
    ],
  },
  "DELETE /projects/{id}/jobs/{jobId}": {
    argv: [...API, "projects", "remove-job", "p-1", "job-1"],
  },
  "POST /projects/{id}/tasks": {
    argv: [
      ...API,
      "projects",
      "add-task",
      "p-1",
      "--input-json",
      '{"taskId":"task-1"}',
    ],
  },
  "DELETE /projects/{id}/tasks/{taskId}": {
    argv: [...API, "projects", "remove-task", "p-1", "task-1"],
  },
  "GET /projects/{id}/context-md": {
    argv: [...API, "projects", "context", "p-1"],
  },
  "GET /projects/{id}/posting-instructions": {
    argv: [...API, "projects", "posting-instructions", "p-1"],
  },
  "PUT /projects/{id}/design-md": {
    argv: [
      ...API,
      "projects",
      "set-design",
      "p-1",
      "--input-json",
      '{"content":"# Design\\n"}',
    ],
  },
  "DELETE /projects/{id}/design-md": {
    argv: [...API, "projects", "clear-design", "p-1"],
  },
  "GET /projects/{id}/needs-attention": {
    argv: [...API, "projects", "needs-attention", "p-1"],
  },
  "GET /projects/{id}/close": {
    argv: [...API, "projects", "close-status", "p-1"],
  },
  "POST /projects/{id}/close": {
    argv: [
      ...API,
      "projects",
      "close",
      "p-1",
      "--input-json",
      '{"operationId":"00000000-0000-4000-8000-00000000c101","expectedProjectRevision":3}',
    ],
  },
  "POST /projects/{id}/close/retry": {
    argv: [
      ...API,
      "projects",
      "retry-close",
      "p-1",
      "--input-json",
      '{"operationId":"00000000-0000-4000-8000-00000000c102","expectedProjectRevision":3,"reason":"Provider was down"}',
    ],
  },
  "POST /projects/{id}/close/cancel-owed": {
    argv: [
      ...API,
      "projects",
      "cancel-owed",
      "p-1",
      "--input-json",
      '{"operationId":"00000000-0000-4000-8000-00000000c103","expectedProjectRevision":3,"reason":"Not needed"}',
    ],
  },
  "GET /projects/{id}/brand-brain": {
    argv: [...API, "projects", "brand-brain", "p-1"],
  },
  "PUT /projects/{id}/brand-brain": {
    argv: [
      ...API,
      "projects",
      "set-brand-brain",
      "p-1",
      "--input-json",
      '{"brandBrain":{"summary":"Running shoes","voice":{},"audience":[],"products":[],"competitors":[],"channels":[]}}',
    ],
  },
  "POST /projects/{id}/brand-brain/answers": {
    argv: [
      ...API,
      "projects",
      "answer-brand-brain",
      "p-1",
      "--input-json",
      '{"questionId":"q-1","answer":"yes"}',
    ],
  },
  "GET /projects/{id}/competitors": {
    argv: [...API, "projects", "competitors", "p-1"],
  },
  "POST /projects/{id}/competitors": {
    argv: [
      ...API,
      "projects",
      "add-competitor",
      "p-1",
      "--input-json",
      '{"name":"Acme"}',
    ],
  },
  "PATCH /projects/{id}/competitors/{competitorId}": {
    argv: [
      ...API,
      "projects",
      "update-competitor",
      "p-1",
      "comp-1",
      "--input-json",
      '{"pricingUrl":"https://acme.example/pricing"}',
    ],
  },
  "DELETE /projects/{id}/competitors/{competitorId}": {
    argv: [...API, "projects", "remove-competitor", "p-1", "comp-1"],
  },
  "POST /projects/{id}/competitors/{competitorId}/restore": {
    argv: [
      ...API,
      "projects",
      "restore-competitor",
      "p-1",
      "comp-1",
      "--input-json",
      '{"removal":1}',
    ],
  },
  "PUT /projects/{id}/competitors/checks": {
    argv: [
      ...API,
      "projects",
      "competitor-checks",
      "p-1",
      "--input-json",
      '{"on":true}',
    ],
  },
  "POST /projects/{id}/competitors/check": {
    argv: [...API, "projects", "check-competitors", "p-1"],
  },
  "POST /projects/{id}/competitors/suggestions": {
    argv: [...API, "projects", "suggest-competitors", "p-1"],
  },
  "GET /projects/{id}/marketing-strategies": {
    argv: [...API, "projects", "strategies", "p-1"],
  },
  "POST /projects/{id}/marketing-strategies": {
    argv: [
      ...API,
      "projects",
      "create-strategy",
      "p-1",
      "--input-json",
      '{"plan":{"month":"2026-12","summary":"Grow signups","goals":[],"pillars":[],"channels":[],"calendar":[]}}',
    ],
  },
  "GET /projects/{id}/marketing-strategies/{strategyId}": {
    argv: [...API, "projects", "strategy", "p-1", "strat-1"],
  },
  "POST /projects/{id}/marketing-strategies/{strategyId}/answers": {
    argv: [
      ...API,
      "projects",
      "answer-strategy",
      "p-1",
      "strat-1",
      "--input-json",
      '{"questionId":"q-1","answer":"no","note":"We only sell online."}',
    ],
  },
  "GET /newsletter/availability": {
    argv: [...API, "newsletter", "availability"],
  },
  "GET /projects/{id}/newsletter": {
    argv: [...API, "newsletter", "get", "p-1"],
  },
  "PUT /projects/{id}/newsletter": {
    argv: [
      ...API,
      "newsletter",
      "set",
      "p-1",
      "--input-json",
      '{"name":"Weekly","senderName":"Ada","replyTo":"ada@example.com","brand":{},"welcomeEmailEnabled":false}',
    ],
  },
  "GET /projects/{id}/newsletter/analytics": {
    argv: [...API, "newsletter", "analytics", "p-1"],
  },
  "GET /projects/{id}/newsletter/issues/{issueId}/analytics": {
    argv: [...API, "newsletter", "issue-analytics", "p-1", "issue-1"],
  },
  "GET /projects/{id}/newsletter/issues": {
    argv: [...API, "newsletter", "issues", "p-1", "--query", "status=DRAFT"],
  },
  "POST /projects/{id}/newsletter/issues": {
    argv: [
      ...API,
      "newsletter",
      "create-issue",
      "p-1",
      "--input-json",
      '{"subject":"December news","template":"TEXT","content":{}}',
    ],
  },
  "POST /projects/{id}/newsletter/issues/draft-with-ai": {
    argv: [
      ...API,
      "newsletter",
      "draft-issue",
      "p-1",
      "--input-json",
      '{"brief":"Our December launch"}',
    ],
  },
  "POST /projects/{id}/newsletter/issues/{issueId}/submit": {
    argv: [
      ...API,
      "newsletter",
      "submit-issue",
      "p-1",
      "issue-1",
      "--input-json",
      '{"revision":2}',
    ],
  },
  "POST /projects/{id}/newsletter/issues/preview": {
    argv: [
      ...API,
      "newsletter",
      "preview",
      "p-1",
      "--input-json",
      '{"subject":"December news","template":"TEXT","content":{}}',
    ],
  },
  "GET /projects/{id}/newsletter/issues/{issueId}": {
    argv: [...API, "newsletter", "issue", "p-1", "issue-1"],
  },
  "PATCH /projects/{id}/newsletter/issues/{issueId}": {
    argv: [
      ...API,
      "newsletter",
      "update-issue",
      "p-1",
      "issue-1",
      "--input-json",
      '{"subject":"December news, updated","revision":2}',
    ],
  },
  "DELETE /projects/{id}/newsletter/issues/{issueId}": {
    argv: [...API, "newsletter", "delete-issue", "p-1", "issue-1"],
  },
  "GET /projects/{id}/newsletter/sending-domain": {
    argv: [...API, "newsletter", "sending-domain", "p-1"],
  },
  "PUT /projects/{id}/newsletter/sending-domain": {
    argv: [
      ...API,
      "newsletter",
      "set-sending-domain",
      "p-1",
      "--input-json",
      '{"fromAddress":"news@acme.example"}',
    ],
  },
  "DELETE /projects/{id}/newsletter/sending-domain": {
    argv: [...API, "newsletter", "remove-sending-domain", "p-1"],
  },
  "POST /projects/{id}/newsletter/sending-domain/check": {
    argv: [...API, "newsletter", "check-sending-domain", "p-1"],
  },
  "GET /projects/{id}/newsletter/sending-domain/domain-connect": {
    argv: [...API, "newsletter", "domain-connect", "p-1"],
  },
  "GET /projects/{id}/newsletter/subscribers": {
    argv: [
      ...API,
      "newsletter",
      "subscribers",
      "p-1",
      "--query",
      "status=ACTIVE",
    ],
  },
  "PATCH /projects/{id}/newsletter/subscribers/{subscriberId}": {
    argv: [
      ...API,
      "newsletter",
      "update-subscriber",
      "p-1",
      "sub-1",
      "--input-json",
      '{"name":"Ada Lovelace"}',
    ],
  },
  "DELETE /projects/{id}/newsletter/subscribers/{subscriberId}": {
    argv: [...API, "newsletter", "remove-subscriber", "p-1", "sub-1"],
  },
  // Ad campaign writes (SOKD-384).
  "POST /projects/{id}/ads/accounts/{accountId}/campaigns": {
    argv: [
      ...API,
      "projects",
      "ads-campaign-create",
      "project-1",
      "account-1",
      "--input-json",
      '{"name":"Spring","dailyBudget":5,"objective":"OUTCOME_TRAFFIC"}',
    ],
  },
  "PATCH /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}": {
    argv: [
      ...API,
      "projects",
      "ads-campaign-update",
      "project-1",
      "account-1",
      "42",
      "--input-json",
      '{"status":"PAUSED"}',
    ],
  },
  "PUT /projects/{id}/ads/accounts/{accountId}/campaigns/{campaignId}": {
    argv: [
      ...API,
      "projects",
      "ads-campaign-edit",
      "project-1",
      "account-1",
      "42",
      "--input-json",
      '{"name":"Spring","dailyBudget":5,"google":{"type":"SEARCH"}}',
    ],
  },
  // SOKD-374: SEO
  "GET /seo/audits": { argv: [...API, "seo", "list-audits"] },
  "POST /seo/audits": {
    argv: [
      ...API,
      "seo",
      "create-audit",
      "--input-json",
      '{"name": "Acme site", "firstPage": {"url": "https://example.com/"}}',
    ],
  },
  "GET /seo/audits/{id}/workspace": {
    argv: [
      ...API,
      "seo",
      "audit-workspace",
      "00000000-0000-4000-8000-0000000000a1",
    ],
  },
  "PATCH /seo/audits/{id}": {
    argv: [
      ...API,
      "seo",
      "audit-archive",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"archived": true}',
    ],
  },
  "GET /seo/audits/{id}/chat": {
    argv: [...API, "seo", "audit-chat", "00000000-0000-4000-8000-0000000000a1"],
  },
  "POST /seo/audits/{id}/chat": {
    argv: [
      ...API,
      "seo",
      "audit-ask",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"question": "Which page should I fix first?", "idempotencyKey": "question-1"}',
    ],
  },
  "GET /seo/audits/{id}": {
    argv: [...API, "seo", "audit-get", "00000000-0000-4000-8000-0000000000a1"],
  },
  "POST /seo/audits/{id}/pages": {
    argv: [
      ...API,
      "seo",
      "audit-add-page",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"url": "https://example.com/pricing"}',
    ],
  },
  "POST /seo/audits/{id}/scopes": {
    argv: [
      ...API,
      "seo",
      "audit-create-scope",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"name": "Pricing", "pageIds": ["00000000-0000-4000-8000-0000000000e1"]}',
    ],
  },
  "PUT /seo/audits/{id}/scopes/{scopeId}": {
    argv: [
      ...API,
      "seo",
      "audit-update-scope",
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000c1",
      "--input-json",
      '{"name": "Pricing", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "expectedVersion": 1}',
    ],
  },
  "POST /seo/audits/{id}/imports": {
    argv: [
      ...API,
      "seo",
      "audit-import-report",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"taskId": "00000000-0000-4000-8000-0000000000d1", "fileId": "file-1"}',
    ],
  },
  "POST /seo/audits/{id}/analyses": {
    argv: [
      ...API,
      "seo",
      "audit-analyze",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"kind": "page_check", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "countryCode": "US", "languageCode": "en", "devices": ["desktop"], "idempotencyKey": "analysis-1"}',
    ],
  },
  "POST /seo/audits/{id}/keywords": {
    argv: [
      ...API,
      "seo",
      "audit-save-keyword",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"keyword": "seo audit", "countryCode": "US", "languageCode": "en"}',
    ],
  },
  "POST /seo/audits/{id}/competitors": {
    argv: [
      ...API,
      "seo",
      "audit-save-competitor",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"url": "https://rival.example", "confirmed": true}',
    ],
  },
  "POST /seo/audits/{id}/actions": {
    argv: [
      ...API,
      "seo",
      "audit-create-task",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"observationId": "00000000-0000-4000-8000-0000000000f1", "actionId": "action-1", "idempotencyKey": "create-task-1"}',
    ],
  },
  "POST /seo/audits/{id}/monitors": {
    argv: [
      ...API,
      "seo",
      "audit-create-monitor",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"operationId": "00000000-0000-4000-8000-0000000000f1", "rule": {"expr": "0 9 * * 1", "timezone": "UTC"}, "analysis": {"kind": "page_check", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "countryCode": "US", "languageCode": "en", "devices": ["desktop"], "idempotencyKey": "analysis-1"}}',
    ],
  },
  "POST /seo/audits/{id}/actions/reviews": {
    argv: [
      ...API,
      "seo",
      "audit-review-action",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"pageId": "00000000-0000-4000-8000-0000000000e1", "actionId": "action-1", "kind": "kept", "baselineObservationId": "00000000-0000-4000-8000-0000000000f1", "observationId": "00000000-0000-4000-8000-0000000000f1"}',
    ],
  },
  "GET /seo/audits/{id}/statistics/properties": {
    argv: [
      ...API,
      "seo",
      "audit-properties",
      "00000000-0000-4000-8000-0000000000a1",
    ],
  },
  "POST /seo/audits/{id}/statistics/sync": {
    argv: [
      ...API,
      "seo",
      "audit-sync-statistics",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"provider": "search_console", "propertyId": "sc-domain:example.com", "from": "2026-10-01", "to": "2026-10-31"}',
    ],
  },
  "POST /seo/audits/{id}/page-changes": {
    argv: [
      ...API,
      "seo",
      "audit-record-change",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"pageIds": ["00000000-0000-4000-8000-0000000000e1"], "occurredAt": "2026-11-01T09:00:00.000Z", "title": "New title tag", "idempotencyKey": "change-0001"}',
    ],
  },
  "PUT /seo/audits/{id}/brand-terms": {
    argv: [
      ...API,
      "seo",
      "audit-set-brand-terms",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"terms": ["acme"]}',
    ],
  },
  "GET /seo/audits/{id}/brief": {
    argv: [
      ...API,
      "seo",
      "audit-brief",
      "00000000-0000-4000-8000-0000000000a1",
    ],
  },
  "PUT /seo/audits/{id}/brief": {
    argv: [
      ...API,
      "seo",
      "audit-save-brief",
      "00000000-0000-4000-8000-0000000000a1",
      "--input-json",
      '{"expectedRevision": 0}',
    ],
  },
  "GET /seo/audits/{id}/brief/suggestion": {
    argv: [
      ...API,
      "seo",
      "audit-suggest-brief",
      "00000000-0000-4000-8000-0000000000a1",
    ],
  },
  "GET /seo/audits/{id}/console-exports/{taskId}": {
    argv: [
      ...API,
      "seo",
      "audit-console-exports",
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000d1",
    ],
  },
  "POST /seo/audits/{id}/console-exports/{taskId}": {
    argv: [
      ...API,
      "seo",
      "audit-import-console-export",
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000d1",
      "--input-json",
      '{"kind": "indexing_examples", "date": "2026-11-01", "csv": "URL"}',
    ],
  },
  "GET /projects/{id}/seo": {
    argv: [
      ...API,
      "seo",
      "project-get",
      "00000000-0000-4000-8000-0000000000b1",
    ],
  },
  "POST /projects/{id}/seo/pages": {
    argv: [
      ...API,
      "seo",
      "project-add-page",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"url": "https://example.com/pricing"}',
    ],
  },
  "POST /projects/{id}/seo/scopes": {
    argv: [
      ...API,
      "seo",
      "project-create-scope",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"name": "Pricing", "pageIds": ["00000000-0000-4000-8000-0000000000e1"]}',
    ],
  },
  "PUT /projects/{id}/seo/scopes/{scopeId}": {
    argv: [
      ...API,
      "seo",
      "project-update-scope",
      "00000000-0000-4000-8000-0000000000b1",
      "00000000-0000-4000-8000-0000000000c1",
      "--input-json",
      '{"name": "Pricing", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "expectedVersion": 1}',
    ],
  },
  "POST /projects/{id}/seo/imports": {
    argv: [
      ...API,
      "seo",
      "project-import-report",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"taskId": "00000000-0000-4000-8000-0000000000d1", "fileId": "file-1"}',
    ],
  },
  "POST /projects/{id}/seo/analyses": {
    argv: [
      ...API,
      "seo",
      "project-analyze",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"kind": "page_check", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "countryCode": "US", "languageCode": "en", "devices": ["desktop"], "idempotencyKey": "analysis-1"}',
    ],
  },
  "POST /projects/{id}/seo/keywords": {
    argv: [
      ...API,
      "seo",
      "project-save-keyword",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"keyword": "seo audit", "countryCode": "US", "languageCode": "en"}',
    ],
  },
  "POST /projects/{id}/seo/competitors": {
    argv: [
      ...API,
      "seo",
      "project-save-competitor",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"url": "https://rival.example", "confirmed": true}',
    ],
  },
  "POST /projects/{id}/seo/actions": {
    argv: [
      ...API,
      "seo",
      "project-create-task",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"observationId": "00000000-0000-4000-8000-0000000000f1", "actionId": "action-1", "idempotencyKey": "create-task-1"}',
    ],
  },
  "POST /projects/{id}/seo/monitors": {
    argv: [
      ...API,
      "seo",
      "project-create-monitor",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"operationId": "00000000-0000-4000-8000-0000000000f1", "rule": {"expr": "0 9 * * 1", "timezone": "UTC"}, "analysis": {"kind": "page_check", "pageIds": ["00000000-0000-4000-8000-0000000000e1"], "countryCode": "US", "languageCode": "en", "devices": ["desktop"], "idempotencyKey": "analysis-1"}}',
    ],
  },
  "POST /projects/{id}/seo/actions/reviews": {
    argv: [
      ...API,
      "seo",
      "project-review-action",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"pageId": "00000000-0000-4000-8000-0000000000e1", "actionId": "action-1", "kind": "kept", "baselineObservationId": "00000000-0000-4000-8000-0000000000f1", "observationId": "00000000-0000-4000-8000-0000000000f1"}',
    ],
  },
  "GET /projects/{id}/seo/statistics/properties": {
    argv: [
      ...API,
      "seo",
      "project-properties",
      "00000000-0000-4000-8000-0000000000b1",
    ],
  },
  "POST /projects/{id}/seo/statistics/sync": {
    argv: [
      ...API,
      "seo",
      "project-sync-statistics",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"provider": "search_console", "propertyId": "sc-domain:example.com", "from": "2026-10-01", "to": "2026-10-31"}',
    ],
  },
  "POST /projects/{id}/seo/page-changes": {
    argv: [
      ...API,
      "seo",
      "project-record-change",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"pageIds": ["00000000-0000-4000-8000-0000000000e1"], "occurredAt": "2026-11-01T09:00:00.000Z", "title": "New title tag", "idempotencyKey": "change-0001"}',
    ],
  },
  "PUT /projects/{id}/seo/brand-terms": {
    argv: [
      ...API,
      "seo",
      "project-set-brand-terms",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"terms": ["acme"]}',
    ],
  },
  "GET /projects/{id}/seo/brief": {
    argv: [
      ...API,
      "seo",
      "project-brief",
      "00000000-0000-4000-8000-0000000000b1",
    ],
  },
  "PUT /projects/{id}/seo/brief": {
    argv: [
      ...API,
      "seo",
      "project-save-brief",
      "00000000-0000-4000-8000-0000000000b1",
      "--input-json",
      '{"expectedRevision": 0}',
    ],
  },
  "GET /projects/{id}/seo/brief/suggestion": {
    argv: [
      ...API,
      "seo",
      "project-suggest-brief",
      "00000000-0000-4000-8000-0000000000b1",
    ],
  },
  "GET /projects/{id}/seo/console-exports/{taskId}": {
    argv: [
      ...API,
      "seo",
      "project-console-exports",
      "00000000-0000-4000-8000-0000000000b1",
      "00000000-0000-4000-8000-0000000000d1",
    ],
  },
  "POST /projects/{id}/seo/console-exports/{taskId}": {
    argv: [
      ...API,
      "seo",
      "project-import-console-export",
      "00000000-0000-4000-8000-0000000000b1",
      "00000000-0000-4000-8000-0000000000d1",
      "--input-json",
      '{"kind": "indexing_examples", "date": "2026-11-01", "csv": "URL"}',
    ],
  },
  // SOKD-375: Drive
  "GET /drive/search": {
    argv: [...API, "drive", "search", "--query", "scope=me"],
  },
  "GET /drive/files": {
    argv: [...API, "drive", "files", "--query", "scope=me"],
  },
  "GET /drive/recents": {
    argv: [...API, "drive", "recents", "--query", "scope=me"],
  },
  "GET /drive/resources/{id}": {
    argv: [...API, "drive", "get", "id-1", "--query", "scope=me"],
  },
  "GET /drive/resources/{id}/related": {
    argv: [...API, "drive", "related", "id-1", "--query", "scope=me"],
  },
  "GET /drive/folders": {
    argv: [...API, "drive", "folders", "--query", "scope=me"],
  },
  "POST /drive/folders": {
    argv: [
      ...API,
      "drive",
      "create-folder",
      "--input-json",
      '{"scope":"me","folderPath":"reports"}',
    ],
  },
  "PATCH /drive/folders/rename": {
    argv: [
      ...API,
      "drive",
      "rename-folder",
      "--input-json",
      '{"scope":"me","oldFolderPath":"a","newFolderPath":"b"}',
    ],
  },
  "DELETE /drive/folders/delete": {
    argv: [
      ...API,
      "drive",
      "delete-folder",
      "--input-json",
      '{"scope":"me","folderPath":"drafts"}',
    ],
  },
  "PATCH /drive/files/move": {
    argv: [
      ...API,
      "drive",
      "move",
      "--input-json",
      '{"sourcePathname":"notes.pdf","targetFolderPath":"reports","itemType":"file"}',
    ],
  },
  "PATCH /drive/files/rename": {
    argv: [
      ...API,
      "drive",
      "rename",
      "--input-json",
      '{"oldPathname":"users/u/a.pdf","newFilename":"b.pdf"}',
    ],
  },
  "DELETE /drive/files/delete": {
    argv: [
      ...API,
      "drive",
      "delete",
      "--input-json",
      '{"pathname":"users/u/a.pdf"}',
    ],
  },
  "PATCH /drive/resources/{id}/metadata": {
    argv: [
      ...API,
      "drive",
      "update-metadata",
      "id-1",
      "--input-json",
      '{"expectedMetadataRevision":1}',
    ],
  },
  "POST /drive/resources/{id}/suggestions/{suggestionId}/decision": {
    argv: [
      ...API,
      "drive",
      "decide-suggestion",
      "id-1",
      "suggestionId-1",
      "--input-json",
      '{"decision":"accept","expectedMetadataRevision":1}',
    ],
  },
  "POST /drive/resources/selection-token": {
    argv: [
      ...API,
      "drive",
      "select",
      "--input-json",
      '{"scope":"me","windowCursor":"c"}',
    ],
  },
  "POST /drive/resources/metadata-batch": {
    argv: [
      ...API,
      "drive",
      "update-metadata-batch",
      "--input-json",
      '{"scope":"me"}',
    ],
  },
  "POST /drive/resources/{id}/reindex": {
    argv: [...API, "drive", "reindex", "id-1", "--query", "scope=me"],
  },
  "POST /drive/files/google-sheets": {
    argv: [
      ...API,
      "drive",
      "add-google-sheet",
      "--input-json",
      '{"scope":"me","url":"https://docs.google.com/spreadsheets/d/abc/edit"}',
    ],
  },
  "GET /drive/resources/{id}/google-sheet": {
    argv: [...API, "drive", "google-sheet", "id-1", "--query", "scope=me"],
  },
  "POST /drive/resources/{id}/google-sheet/refresh": {
    argv: [
      ...API,
      "drive",
      "refresh-google-sheet",
      "id-1",
      "--query",
      "scope=me",
    ],
  },
  "GET /drive/tasks": {
    argv: [...API, "drive", "tasks", "--query", "scope=me"],
  },
  "POST /drive/tasks/copy": {
    argv: [
      ...API,
      "drive",
      "copy-task-file",
      "--input-json",
      '{"scope":"me","taskFileId":"tf-1"}',
    ],
  },
  "GET /drive/labels": {
    argv: [...API, "drive", "labels", "--query", "scope=me"],
  },
  "POST /drive/labels": {
    argv: [
      ...API,
      "drive",
      "create-label",
      "--input-json",
      '{"scope":"me","kind":"TAG","displayName":"Contracts"}',
    ],
  },
  "PATCH /drive/labels/{id}": {
    argv: [
      ...API,
      "drive",
      "update-label",
      "id-1",
      "--input-json",
      '{"scope":"me","displayName":"Signed"}',
    ],
  },
  "GET /drive/collections": {
    argv: [...API, "drive", "collections", "--query", "scope=me"],
  },
  "POST /drive/collections": {
    argv: [
      ...API,
      "drive",
      "create-collection",
      "--input-json",
      '{"scope":"me","name":"Contracts","definition":{}}',
    ],
  },
  "PATCH /drive/collections/{id}": {
    argv: [
      ...API,
      "drive",
      "update-collection",
      "id-1",
      "--input-json",
      '{"scope":"me","name":"Signed"}',
    ],
  },
  "DELETE /drive/collections/{id}": {
    argv: [...API, "drive", "delete-collection", "id-1", "--query", "scope=me"],
  },
  "GET /drive/shares": {
    argv: [...API, "drive", "share", "--query", "scope=me"],
  },
  "DELETE /drive/shares/{id}": {
    argv: [...API, "drive", "unshare", "id-1", "--query", "scope=me"],
  },
  "GET /drive/tables": { argv: [...API, "drive", "tables"] },
  "POST /drive/tables": {
    argv: [
      ...API,
      "drive",
      "create-table",
      "--input-json",
      '{"key":"k-1","title":"Leads","columns":[]}',
    ],
  },
  "GET /drive/tables/{id}": { argv: [...API, "drive", "table", "id-1"] },
  "PATCH /drive/tables/{id}": {
    argv: [
      ...API,
      "drive",
      "update-table",
      "id-1",
      "--input-json",
      '{"key":"k-1","version":1}',
    ],
  },
  "POST /drive/tables/{id}/query": {
    argv: [...API, "drive", "query-table", "id-1", "--input-json", "{}"],
  },
  "POST /drive/tables/{id}/rows": {
    argv: [
      ...API,
      "drive",
      "edit-rows",
      "id-1",
      "--input-json",
      '{"key":"k-1","insert":[]}',
    ],
  },
  "POST /drive/tables/{id}/views": {
    argv: [
      ...API,
      "drive",
      "save-view",
      "id-1",
      "--input-json",
      '{"key":"k-1","name":"Open","definition":{}}',
    ],
  },
  "POST /drive/tables/{id}/undo": {
    argv: [
      ...API,
      "drive",
      "undo-table",
      "id-1",
      "--input-json",
      '{"key":"k-1","batchId":"b-1"}',
    ],
  },
  "GET /drive/tables/{id}/history": {
    argv: [...API, "drive", "table-history", "id-1"],
  },
  "POST /drive/tables/{id}/enrich": {
    argv: [
      ...API,
      "drive",
      "enrich-table",
      "id-1",
      "--input-json",
      '{"key":"k-1","prompt":"Fill","rowIds":[],"columnIds":[]}',
    ],
  },
  "GET /drive/data-rooms": {
    argv: [...API, "drive", "data-rooms", "--query", "scope=me"],
  },
  "POST /drive/data-rooms": {
    argv: [
      ...API,
      "drive",
      "create-data-room",
      "--input-json",
      '{"scope":"me","folderPath":"deal"}',
    ],
  },
  "GET /drive/data-rooms/questions": {
    argv: [...API, "drive", "open-questions", "--query", "scope=me"],
  },
  "GET /drive/data-rooms/{id}": {
    argv: [...API, "drive", "data-room", "id-1", "--query", "scope=me"],
  },
  "DELETE /drive/data-rooms/{id}": {
    argv: [...API, "drive", "close-data-room", "id-1", "--query", "scope=me"],
  },
  "DELETE /drive/data-rooms/{id}/members/{memberId}": {
    argv: [
      ...API,
      "drive",
      "remove-data-room-member",
      "id-1",
      "memberId-1",
      "--query",
      "scope=me",
    ],
  },
  "GET /drive/data-rooms/{id}/events": {
    argv: [...API, "drive", "data-room-events", "id-1", "--query", "scope=me"],
  },
  "GET /drive/data-rooms/{id}/questions": {
    argv: [
      ...API,
      "drive",
      "data-room-questions",
      "id-1",
      "--query",
      "scope=me",
    ],
  },
  "PUT /drive/data-rooms/{id}/order": {
    argv: [
      ...API,
      "drive",
      "order-data-room",
      "id-1",
      "--input-json",
      '{"scope":"me","entries":[]}',
    ],
  },
  "PUT /drive/data-rooms/{id}/colleagues": {
    argv: [
      ...API,
      "drive",
      "set-data-room-colleagues",
      "id-1",
      "--input-json",
      '{"scope":"org","organizationId":"org-1","userIds":[]}',
    ],
  },
  // SOKD-376: contacts and contact lists.
  "GET /contacts": { argv: [...API, "contacts", "list"] },
  "POST /contacts": {
    argv: [
      ...API,
      "contacts",
      "create",
      "--input-json",
      '{"name":"Nina Keller"}',
    ],
  },
  "GET /contacts/export.csv": { argv: [...API, "contacts", "export"] },
  "GET /contacts/map": { argv: [...API, "contacts", "map"] },
  "POST /contacts/merge": {
    argv: [
      ...API,
      "contacts",
      "merge",
      "--input-json",
      '{"winnerId":"contact-1","loserIds":["contact-2"]}',
    ],
  },
  "GET /contacts/duplicates": { argv: [...API, "contacts", "list-duplicates"] },
  "POST /contacts/duplicates/dismiss": {
    argv: [
      ...API,
      "contacts",
      "dismiss-duplicates",
      "--input-json",
      '{"contactIds":["contact-1","contact-2"]}',
    ],
  },
  "POST /contacts/stage": {
    argv: [
      ...API,
      "contacts",
      "set-stage",
      "--input-json",
      '{"contactIds":["contact-1"],"stage":"LEAD"}',
    ],
  },
  "POST /contacts/stage/undo": {
    argv: [
      ...API,
      "contacts",
      "undo-stage",
      "--input-json",
      '{"contacts":[{"id":"contact-1","stage":"PROSPECT","version":2}]}',
    ],
  },
  "POST /contacts/import": {
    argv: [
      ...API,
      "contacts",
      "import",
      "--input-json",
      '{"tableId":"table-1","mapping":{"name":"Name"}}',
    ],
  },
  "POST /contacts/linkedin-connections": {
    argv: [
      ...API,
      "contacts",
      "import-linkedin",
      "--input-json",
      '{"csv":"First Name,Last Name,URL\\nNina,Keller,https://www.linkedin.com/in/nina"}',
    ],
  },
  "GET /contacts/organizations": {
    argv: [...API, "contacts", "list-organizations"],
  },
  "GET /contacts/companies": { argv: [...API, "contacts", "list-companies"] },
  "GET /contacts/companies/{companyId}": {
    argv: [...API, "contacts", "get-company", "company-1"],
  },
  "PATCH /contacts/companies/{companyId}": {
    argv: [
      ...API,
      "contacts",
      "update-company",
      "company-1",
      "--input-json",
      '{"version":1}',
    ],
  },
  "GET /contacts/company-lists": {
    argv: [...API, "contacts", "list-company-lists"],
  },
  "POST /contacts/company-lists": {
    argv: [
      ...API,
      "contacts",
      "create-company-list",
      "--input-json",
      '{"name":"Targets"}',
    ],
  },
  "PATCH /contacts/company-lists/{listId}": {
    argv: [
      ...API,
      "contacts",
      "update-company-list",
      "company-list-1",
      "--input-json",
      '{"name":"Q1 targets"}',
    ],
  },
  "DELETE /contacts/company-lists/{listId}": {
    argv: [...API, "contacts", "delete-company-list", "company-list-1"],
  },
  "POST /contacts/company-lists/{listId}/members": {
    argv: [
      ...API,
      "contacts",
      "update-company-list-members",
      "company-list-1",
      "--input-json",
      '{"add":["company-1"]}',
    ],
  },
  "GET /contacts/breakdown": { argv: [...API, "contacts", "breakdown"] },
  "GET /contacts/{id}": { argv: [...API, "contacts", "get", "contact-1"] },
  "PATCH /contacts/{id}": {
    argv: [
      ...API,
      "contacts",
      "update",
      "contact-1",
      "--input-json",
      '{"version":1,"role":"Founder"}',
    ],
  },
  "POST /contacts/{id}/archive": {
    argv: [...API, "contacts", "archive", "contact-1"],
  },
  "POST /contacts/{id}/unarchive": {
    argv: [...API, "contacts", "unarchive", "contact-1"],
  },
  "POST /contacts/{id}/channels": {
    argv: [
      ...API,
      "contacts",
      "add-channel",
      "contact-1",
      "--input-json",
      '{"type":"EMAIL","value":"nina@example.com"}',
    ],
  },
  "DELETE /contacts/{id}/channels/{channelId}": {
    argv: [...API, "contacts", "remove-channel", "contact-1", "channel-1"],
  },
  "GET /contacts/{id}/interactions": {
    argv: [...API, "contacts", "list-interactions", "contact-1"],
  },
  "POST /contacts/{id}/interactions": {
    argv: [
      ...API,
      "contacts",
      "add-interaction",
      "contact-1",
      "--input-json",
      '{"occurredAt":"2026-11-24T10:00:00Z","channel":"EMAIL","summary":"Intro call"}',
    ],
  },
  "DELETE /contacts/{id}/interactions/{interactionId}": {
    argv: [
      ...API,
      "contacts",
      "delete-interaction",
      "contact-1",
      "interaction-1",
    ],
  },
  "PUT /contacts/{id}/importance": {
    argv: [
      ...API,
      "contacts",
      "set-importance",
      "contact-1",
      "--input-json",
      '{"importance":80}',
    ],
  },
  "POST /contacts/{id}/enrich": {
    argv: [...API, "contacts", "enrich", "contact-1"],
  },
  "GET /contacts/{id}/activity": {
    argv: [...API, "contacts", "activity", "contact-1"],
  },
  "GET /contact-lists": { argv: [...API, "contacts", "list-lists"] },
  "POST /contact-lists": {
    argv: [
      ...API,
      "contacts",
      "create-list",
      "--input-json",
      '{"name":"Investors"}',
    ],
  },
  "PATCH /contact-lists/{id}": {
    argv: [
      ...API,
      "contacts",
      "update-list",
      "list-1",
      "--input-json",
      '{"color":"blue"}',
    ],
  },
  "DELETE /contact-lists/{id}": {
    argv: [...API, "contacts", "delete-list", "list-1"],
  },
  "POST /contact-lists/{id}/members": {
    argv: [
      ...API,
      "contacts",
      "update-list-members",
      "list-1",
      "--input-json",
      '{"remove":["contact-1"]}',
    ],
  },
  "POST /contact-lists/{id}/import": {
    argv: [
      ...API,
      "contacts",
      "import-list",
      "list-1",
      "--input-json",
      '{"text":"nina@example.com"}',
    ],
  },
  "GET /contact-lists/{id}/suggestions": {
    argv: [...API, "contacts", "list-suggestions", "list-1"],
  },
  "POST /contact-lists/{id}/find": {
    argv: [
      ...API,
      "contacts",
      "find-people",
      "list-1",
      "--input-json",
      '{"brief":"Seed investors in Berlin"}',
    ],
  },
  "POST /contact-lists/{id}/suggestions/add": {
    argv: [
      ...API,
      "contacts",
      "add-suggestions",
      "list-1",
      "--input-json",
      '{"ids":["suggestion-1"]}',
    ],
  },
  "POST /contact-lists/{id}/suggestions/dismiss": {
    argv: [
      ...API,
      "contacts",
      "dismiss-suggestions",
      "list-1",
      "--input-json",
      '{"ids":["suggestion-1"]}',
    ],
  },
  // SOKD-377 chats
  "GET /chats/invitations": {
    argv: [...API, "chats", "invitations"],
  },
  "GET /chats/invitations/{id}": {
    argv: [...API, "chats", "get-invitation", "inv-1"],
  },
  "POST /chats/invitations/{id}/accept": {
    argv: [...API, "chats", "accept-invitation", "inv-1"],
  },
  "POST /chats/invitations/{id}/decline": {
    argv: [...API, "chats", "decline-invitation", "inv-1"],
  },
  "GET /chats/people": {
    argv: [...API, "chats", "people"],
  },
  "GET /chats/rooms": {
    argv: [...API, "chats", "rooms"],
  },
  "POST /chats/rooms": {
    argv: [
      ...API,
      "chats",
      "create-room",
      "--input-json",
      '{"kind":"direct","memberUserIds":["user-2"]}',
    ],
  },
  "GET /chats/rooms/discoverable": {
    argv: [...API, "chats", "discoverable"],
  },
  "GET /chats/rooms/channel-slug-availability": {
    argv: [...API, "chats", "slug-available", "--query", "slug=launch"],
  },
  "PUT /chats/rooms/starred": {
    argv: [
      ...API,
      "chats",
      "order-starred",
      "--input-json",
      '{"roomIds":["room-1"]}',
    ],
  },
  "GET /chats/rooms/{id}/pinned-messages": {
    argv: [...API, "chats", "pinned", "room-1"],
  },
  "GET /chats/rooms/{id}": {
    argv: [...API, "chats", "get-room", "room-1"],
  },
  "PATCH /chats/rooms/{id}": {
    argv: [
      ...API,
      "chats",
      "update-room",
      "room-1",
      "--input-json",
      '{"topic":"Launch week"}',
    ],
  },
  "DELETE /chats/rooms/{id}": {
    argv: [...API, "chats", "delete-room", "room-1"],
  },
  "POST /chats/rooms/{id}/archive": {
    argv: [...API, "chats", "archive-room", "room-1"],
  },
  "POST /chats/rooms/{id}/restore": {
    argv: [...API, "chats", "restore-room", "room-1"],
  },
  "GET /chats/rooms/{id}/invitations": {
    argv: [...API, "chats", "room-invitations", "room-1"],
  },
  "POST /chats/rooms/{id}/invitations": {
    argv: [
      ...API,
      "chats",
      "invite-guest",
      "room-1",
      "--input-json",
      '{"email":"guest@example.com"}',
    ],
  },
  "DELETE /chats/rooms/{id}/invitations/{invitationId}": {
    argv: [...API, "chats", "revoke-invitation", "room-1", "inv-1"],
  },
  "GET /chats/rooms/{id}/invite-links": {
    argv: [...API, "chats", "invite-links", "room-1"],
  },
  "POST /chats/rooms/{id}/invite-links": {
    argv: [
      ...API,
      "chats",
      "create-invite-link",
      "room-1",
      "--input-json",
      '{"expiresInDays":7}',
    ],
  },
  "DELETE /chats/rooms/{id}/invite-links/{token}": {
    argv: [...API, "chats", "revoke-invite-link", "room-1", "token-1"],
  },
  "POST /chats/rooms/{id}/members/me": {
    argv: [...API, "chats", "join", "room-1"],
  },
  "DELETE /chats/rooms/{id}/members/me": {
    argv: [...API, "chats", "leave", "room-1"],
  },
  "DELETE /chats/rooms/{id}/members/{userId}": {
    argv: [...API, "chats", "remove-member", "room-1", "user-2"],
  },
  "POST /chats/rooms/{id}/members": {
    argv: [
      ...API,
      "chats",
      "add-members",
      "room-1",
      "--input-json",
      '{"userIds":["user-2"]}',
    ],
  },
  "DELETE /chats/rooms/{id}/coworkers/{coworkerId}": {
    argv: [...API, "chats", "remove-coworker", "room-1", "cw-1"],
  },
  "DELETE /chats/rooms/{id}/soko-bots/{sokoBotId}": {
    argv: [...API, "chats", "remove-soko-bot", "room-1", "bot-1"],
  },
  "POST /chats/rooms/{id}/read": {
    argv: [...API, "chats", "mark-read", "room-1"],
  },
  "POST /chats/rooms/{id}/unread": {
    argv: [...API, "chats", "mark-unread", "room-1"],
  },
  "POST /chats/rooms/{id}/star": {
    argv: [...API, "chats", "star", "room-1"],
  },
  "DELETE /chats/rooms/{id}/star": {
    argv: [...API, "chats", "unstar", "room-1"],
  },
  "POST /chats/rooms/{id}/mute": {
    argv: [...API, "chats", "mute", "room-1"],
  },
  "DELETE /chats/rooms/{id}/mute": {
    argv: [...API, "chats", "unmute", "room-1"],
  },
  "GET /chats/rooms/{id}/threads": {
    argv: [...API, "chats", "threads", "room-1", "--query", "unread=true"],
  },
  "GET /chats/rooms/{id}/threads/unread-count": {
    argv: [...API, "chats", "thread-unread-count", "room-1"],
  },
  "POST /chats/rooms/{id}/threads/read": {
    argv: [...API, "chats", "read-threads", "room-1"],
  },
  "GET /chats/rooms/{id}/threads/{parentMessageId}": {
    argv: [...API, "chats", "get-thread", "room-1", "msg-1"],
  },
  "GET /chats/rooms/{id}/threads/{parentMessageId}/messages": {
    argv: [...API, "chats", "thread-messages", "room-1", "msg-1"],
  },
  "POST /chats/rooms/{id}/threads/{parentMessageId}/read": {
    argv: [...API, "chats", "read-thread", "room-1", "msg-1"],
  },
  "POST /chats/rooms/{id}/threads/{parentMessageId}/mute": {
    argv: [...API, "chats", "mute-thread", "room-1", "msg-1"],
  },
  "DELETE /chats/rooms/{id}/threads/{parentMessageId}/mute": {
    argv: [...API, "chats", "unmute-thread", "room-1", "msg-1"],
  },
  "GET /chats/threads/unread": {
    argv: [...API, "chats", "unread-threads"],
  },
  "GET /chats/threads/earlier": {
    argv: [...API, "chats", "earlier-threads"],
  },
  "GET /chats/rooms/{id}/messages": {
    argv: [...API, "chats", "messages", "room-1", "--query", "limit=20"],
  },
  "POST /chats/rooms/{id}/messages": {
    argv: [
      ...API,
      "chats",
      "send",
      "room-1",
      "--input-json",
      '{"content":"Draft is ready."}',
    ],
  },
  "GET /chats/rooms/{id}/messages/{messageId}": {
    argv: [...API, "chats", "get-message", "room-1", "msg-1"],
  },
  "PATCH /chats/rooms/{id}/messages/{messageId}": {
    argv: [
      ...API,
      "chats",
      "edit-message",
      "room-1",
      "msg-1",
      "--input-json",
      '{"content":"Draft is ready now."}',
    ],
  },
  "DELETE /chats/rooms/{id}/messages/{messageId}": {
    argv: [...API, "chats", "delete-message", "room-1", "msg-1"],
  },
  "GET /chats/rooms/{id}/messages/{messageId}/results": {
    argv: [...API, "chats", "get-message-results", "room-1", "msg-1"],
  },
  "GET /chats/rooms/{id}/message-results": {
    argv: [
      ...API,
      "chats",
      "message-results",
      "room-1",
      "--query",
      "messageIds=msg-1",
    ],
  },
  "PUT /chats/rooms/{id}/messages/{messageId}/reactions/{emoji}": {
    argv: [...API, "chats", "react", "room-1", "msg-1", "👍"],
  },
  "DELETE /chats/rooms/{id}/messages/{messageId}/reactions/{emoji}": {
    argv: [...API, "chats", "unreact", "room-1", "msg-1", "👍"],
  },
  "POST /chats/rooms/{id}/messages/{messageId}/pin": {
    argv: [...API, "chats", "pin", "room-1", "msg-1"],
  },
  "DELETE /chats/rooms/{id}/messages/{messageId}/pin": {
    argv: [...API, "chats", "unpin", "room-1", "msg-1"],
  },
  "POST /chats/rooms/{id}/messages/{messageId}/send-to-self": {
    argv: [...API, "chats", "send-to-self", "room-1", "msg-1"],
  },
  "POST /chats/rooms/{id}/messages/{messageId}/unfurls/remove": {
    argv: [
      ...API,
      "chats",
      "remove-unfurl",
      "room-1",
      "msg-1",
      "--input-json",
      '{"url":"https://example.com"}',
    ],
  },
  "POST /chats/rooms/{id}/messages/{messageId}/mentions/{mentionId}/retry": {
    argv: [...API, "chats", "retry-mention", "room-1", "msg-1", "mention-1"],
  },
  "POST /chats/rooms/{id}/files": {
    argv: [
      ...API,
      "chats",
      "upload-file",
      "room-1",
      "--input-json",
      '{"filename":"brief.pdf","contentType":"application/pdf","size":1024}',
    ],
  },
  "GET /chats/saved-messages": {
    argv: [...API, "chats", "saved"],
  },
  "PUT /chats/saved-messages/{messageId}": {
    argv: [...API, "chats", "save", "msg-1"],
  },
  "DELETE /chats/saved-messages/{messageId}": {
    argv: [...API, "chats", "unsave", "msg-1"],
  },
  "GET /chats/signals/decisions": {
    argv: [...API, "chats", "decisions"],
  },
  "GET /chats/signals/important": {
    argv: [...API, "chats", "important"],
  },
  "GET /chats/signals/summary": {
    argv: [...API, "chats", "summary"],
  },
  "GET /chats/signals/rooms/{id}/catch-up": {
    argv: [...API, "chats", "catch-up", "room-1"],
  },
  "GET /chats/signals/rooms/{id}/decisions": {
    argv: [...API, "chats", "room-decisions", "room-1"],
  },
  "PUT /chats/signals/messages/{messageId}/corrections": {
    argv: [
      ...API,
      "chats",
      "correct-signal",
      "msg-1",
      "--input-json",
      '{"tag":"decisionMade","applies":false}',
    ],
  },
  "PUT /chats/signals/messages/{messageId}/loop": {
    argv: [
      ...API,
      "chats",
      "set-loop",
      "msg-1",
      "--input-json",
      '{"closed":true}',
    ],
  },
  "GET /chats/signals/messages/{messageId}/routing": {
    argv: [...API, "chats", "routing", "msg-1"],
  },
  "GET /chats/skills": {
    argv: [...API, "chats", "skills", "--query", "q=seo"],
  },
  "GET /chats/stickers": {
    argv: [...API, "chats", "stickers"],
  },
  // SOKD-377 soko-bots
  "GET /soko-bots/me": {
    argv: [...API, "soko-bots", "me"],
  },
  "POST /soko-bots/me": {
    argv: [
      ...API,
      "soko-bots",
      "create-mine",
      "--input-json",
      '{"name":"Pebble"}',
    ],
  },
  "DELETE /soko-bots/me": {
    argv: [...API, "soko-bots", "archive-mine"],
  },
  "DELETE /soko-bots/me/permanent": {
    argv: [...API, "soko-bots", "delete-mine"],
  },
  "GET /soko-bots/me/activity": {
    argv: [...API, "soko-bots", "my-activity"],
  },
  "GET /soko-bots/me/usage": {
    argv: [...API, "soko-bots", "my-usage"],
  },
  "GET /soko-bots/me/stats": {
    argv: [...API, "soko-bots", "my-stats"],
  },
  "GET /soko-bots/me/turns": {
    argv: [...API, "soko-bots", "my-turns"],
  },
  "POST /soko-bots/me/turns": {
    argv: [
      ...API,
      "soko-bots",
      "ask-mine",
      "--input-json",
      '{"clientTurnId":"cli-1","message":"What is due this week?"}',
    ],
  },
  "GET /soko-bots/me/turns/{turnId}": {
    argv: [...API, "soko-bots", "my-turn", "turn-1"],
  },
  "GET /soko-bots/me/turns/{turnId}/results": {
    argv: [...API, "soko-bots", "my-turn-results", "turn-1"],
  },
  "GET /soko-bots/me/turns/{id}/conversation": {
    argv: [...API, "soko-bots", "my-turn-conversation", "turn-1"],
  },
  "POST /soko-bots/me/turns/{turnId}/cancel": {
    argv: [...API, "soko-bots", "cancel-my-turn", "turn-1"],
  },
  "POST /soko-bots/me/turns/{id}/feedback": {
    argv: [
      ...API,
      "soko-bots",
      "rate-my-turn",
      "turn-1",
      "--input-json",
      '{"useful":true}',
    ],
  },
  "POST /soko-bots/me/memory/reset": {
    argv: [...API, "soko-bots", "reset-my-memory"],
  },
  "POST /soko-bots/me/schedules": {
    argv: [
      ...API,
      "soko-bots",
      "create-my-schedule",
      "--input-json",
      '{"name":"Standup","prompt":"Summarize yesterday","cronExpression":"0 9 * * 1-5","timezone":"Europe/Berlin"}',
    ],
  },
  "PATCH /soko-bots/me/schedules/{scheduleId}": {
    argv: [
      ...API,
      "soko-bots",
      "update-my-schedule",
      "schedule-1",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "DELETE /soko-bots/me/schedules/{scheduleId}": {
    argv: [...API, "soko-bots", "delete-my-schedule", "schedule-1"],
  },
  "POST /soko-bots/me/introduce": {
    argv: [
      ...API,
      "soko-bots",
      "introduce-mine",
      "--input-json",
      '{"roomId":"room-1"}',
    ],
  },
  "PUT /soko-bots/me/name": {
    argv: [
      ...API,
      "soko-bots",
      "rename-mine",
      "--input-json",
      '{"name":"Pebble"}',
    ],
  },
  "PUT /soko-bots/me/avatar-code": {
    argv: [
      ...API,
      "soko-bots",
      "set-my-avatar",
      "--input-json",
      '{"code":"ab12"}',
    ],
  },
  "PUT /soko-bots/me/version": {
    argv: [
      ...API,
      "soko-bots",
      "set-my-version",
      "--input-json",
      '{"versionId":"version-1"}',
    ],
  },
  "PUT /soko-bots/me/proactive": {
    argv: [
      ...API,
      "soko-bots",
      "set-my-proactive",
      "--input-json",
      '{"paused":true}',
    ],
  },
  "PUT /soko-bots/me/board-following": {
    argv: [
      ...API,
      "soko-bots",
      "set-my-board-following",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "PUT /soko-bots/me/team-standup": {
    argv: [
      ...API,
      "soko-bots",
      "set-my-team-standup",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "GET /soko-bots/me/skills": {
    argv: [...API, "soko-bots", "my-skills"],
  },
  "POST /soko-bots/me/skills": {
    argv: [
      ...API,
      "soko-bots",
      "install-my-skill",
      "--input-json",
      '{"source":"owner/repo"}',
    ],
  },
  "DELETE /soko-bots/me/skills/{skillId}": {
    argv: [...API, "soko-bots", "remove-my-skill", "skill-1"],
  },
  "POST /soko-bots/me/lab/ingest": {
    argv: [
      ...API,
      "soko-bots",
      "lab-ingest",
      "--input-json",
      '{"beat":"standup"}',
    ],
  },
  "POST /soko-bots/me/lab/task-event": {
    argv: [
      ...API,
      "soko-bots",
      "lab-task-event",
      "--input-json",
      '{"status":"COMPLETED","comment":"Done"}',
    ],
  },
  "GET /soko-bots/me/lab/runs": {
    argv: [...API, "soko-bots", "lab-runs"],
  },
  "POST /soko-bots/me/lab/judge": {
    argv: [
      ...API,
      "soko-bots",
      "lab-judge",
      "--input-json",
      '{"turnId":"turn-1","scenarioId":"standup"}',
    ],
  },
  "GET /soko-bots/versions": {
    argv: [...API, "soko-bots", "versions"],
  },
  "GET /soko-bots/team": {
    argv: [...API, "soko-bots", "team"],
  },
  "GET /soko-bots/skills/search": {
    argv: [...API, "soko-bots", "search-skills", "--query", "q=seo"],
  },
  "GET /soko-bots/skills/browse": {
    argv: [...API, "soko-bots", "browse-skills"],
  },
  "POST /soko-bots": {
    argv: [
      ...API,
      "soko-bots",
      "create",
      "--input-json",
      '{"scope":"workspace","name":"Ops"}',
    ],
  },
  "GET /soko-bots/{sokoBotId}": {
    argv: [...API, "soko-bots", "get", "bot-1"],
  },
  "POST /soko-bots/{sokoBotId}": {
    argv: [...API, "soko-bots", "reactivate", "bot-1"],
  },
  "DELETE /soko-bots/{sokoBotId}": {
    argv: [...API, "soko-bots", "archive", "bot-1"],
  },
  "DELETE /soko-bots/{sokoBotId}/permanent": {
    argv: [...API, "soko-bots", "delete", "bot-1"],
  },
  "GET /soko-bots/{sokoBotId}/activity": {
    argv: [...API, "soko-bots", "activity", "bot-1"],
  },
  "GET /soko-bots/{sokoBotId}/usage": {
    argv: [...API, "soko-bots", "usage", "bot-1"],
  },
  "GET /soko-bots/{sokoBotId}/stats": {
    argv: [...API, "soko-bots", "stats", "bot-1"],
  },
  "GET /soko-bots/{sokoBotId}/turns": {
    argv: [...API, "soko-bots", "turns", "bot-1"],
  },
  "POST /soko-bots/{sokoBotId}/turns": {
    argv: [
      ...API,
      "soko-bots",
      "ask",
      "bot-1",
      "--input-json",
      '{"clientTurnId":"cli-1","message":"What is due this week?"}',
    ],
  },
  "GET /soko-bots/{sokoBotId}/turns/{turnId}": {
    argv: [...API, "soko-bots", "turn", "bot-1", "turn-1"],
  },
  "GET /soko-bots/{sokoBotId}/turns/{turnId}/results": {
    argv: [...API, "soko-bots", "turn-results", "bot-1", "turn-1"],
  },
  "POST /soko-bots/{sokoBotId}/turns/{turnId}/cancel": {
    argv: [...API, "soko-bots", "cancel-turn", "bot-1", "turn-1"],
  },
  "POST /soko-bots/{sokoBotId}/memory/reset": {
    argv: [...API, "soko-bots", "reset-memory", "bot-1"],
  },
  "POST /soko-bots/{sokoBotId}/schedules": {
    argv: [
      ...API,
      "soko-bots",
      "create-schedule",
      "bot-1",
      "--input-json",
      '{"name":"Standup","prompt":"Summarize yesterday","cronExpression":"0 9 * * 1-5","timezone":"Europe/Berlin"}',
    ],
  },
  "PATCH /soko-bots/{sokoBotId}/schedules/{scheduleId}": {
    argv: [
      ...API,
      "soko-bots",
      "update-schedule",
      "bot-1",
      "schedule-1",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "DELETE /soko-bots/{sokoBotId}/schedules/{scheduleId}": {
    argv: [...API, "soko-bots", "delete-schedule", "bot-1", "schedule-1"],
  },
  "PUT /soko-bots/{sokoBotId}/name": {
    argv: [
      ...API,
      "soko-bots",
      "rename",
      "bot-1",
      "--input-json",
      '{"name":"Ops"}',
    ],
  },
  "PUT /soko-bots/{sokoBotId}/avatar-code": {
    argv: [
      ...API,
      "soko-bots",
      "set-avatar",
      "bot-1",
      "--input-json",
      '{"code":"ab12"}',
    ],
  },
  "PUT /soko-bots/{sokoBotId}/version": {
    argv: [
      ...API,
      "soko-bots",
      "set-version",
      "bot-1",
      "--input-json",
      '{"versionId":"version-1"}',
    ],
  },
  "PUT /soko-bots/{sokoBotId}/proactive": {
    argv: [
      ...API,
      "soko-bots",
      "set-proactive",
      "bot-1",
      "--input-json",
      '{"paused":true}',
    ],
  },
  "PUT /soko-bots/{sokoBotId}/board-following": {
    argv: [
      ...API,
      "soko-bots",
      "set-board-following",
      "bot-1",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "PUT /soko-bots/{sokoBotId}/team-standup": {
    argv: [
      ...API,
      "soko-bots",
      "set-team-standup",
      "bot-1",
      "--input-json",
      '{"enabled":false}',
    ],
  },
  "GET /soko-bots/me/integrations": {
    argv: [...API, "soko-bots", "my-integrations"],
  },
  "GET /soko-bots/{sokoBotId}/integrations": {
    argv: [...API, "soko-bots", "integrations", "bot-1"],
  },
  "GET /soko-bots/integrations/catalog": {
    argv: [
      ...API,
      "soko-bots",
      "integration-catalog",
      "--query",
      "query=gmail",
    ],
  },
};
