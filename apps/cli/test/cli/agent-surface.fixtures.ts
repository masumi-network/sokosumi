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
  "GET /users/{id}/credits": { argv: [...API, "users", "credits", "me"] },
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
  "POST /users/{id}/coworker-access/{accessId}/approve": {
    argv: [
      ...API,
      "users",
      "approve-coworker-access",
      "me",
      "access-1",
      "--input-json",
      "{}",
    ],
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
  "POST /users/{id}/vendor-grants": {
    argv: [
      ...API,
      "users",
      "grant-vendor",
      "me",
      "--input-json",
      '{"vendorId":"vendor-1"}',
    ],
  },
  "POST /users/{id}/vendor-grants/{grantId}/approve": {
    argv: [
      ...API,
      "users",
      "approve-vendor-grant",
      "me",
      "grant-1",
      "--input-json",
      "{}",
    ],
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
    argv: [...API, "workspaces", "preferred", "me"],
  },
  "PUT /users/{id}/workspaces/preferred": {
    argv: [
      ...API,
      "workspaces",
      "set-preferred",
      "me",
      "--input-json",
      '{"workspaceId":"ws-1"}',
    ],
  },
  "DELETE /users/{id}/workspaces/{workspaceId}": {
    argv: [...API, "workspaces", "delete", "me", "ws-1"],
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
  "POST /organizations/{id}/coworker-access/{accessId}/approve": {
    argv: [
      ...API,
      "organizations",
      "approve-coworker-access",
      "org-1",
      "access-1",
      "--input-json",
      "{}",
    ],
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
  "POST /organizations/{id}/vendor-grants": {
    argv: [
      ...API,
      "organizations",
      "grant-vendor",
      "org-1",
      "--input-json",
      '{"vendorId":"vendor-1"}',
    ],
  },
  "POST /organizations/{id}/vendor-grants/{grantId}/approve": {
    argv: [
      ...API,
      "organizations",
      "approve-vendor-grant",
      "org-1",
      "grant-1",
      "--input-json",
      "{}",
    ],
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
};
