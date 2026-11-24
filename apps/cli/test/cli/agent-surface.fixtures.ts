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
  "POST /users/{id}/workspaces": {
    argv: [
      "--preprod",
      "coworkers",
      "register",
      "--personal",
      "--vendor-id",
      "vendor-1",
      "--name",
      "Agent",
      "--json",
    ],
    response: (request) =>
      ({
        "POST /coworkers/cw-1/workspace-access": {
          data: {
            id: "req-1",
            coworkerId: "cw-1",
            workspaceId: PERSONAL,
            status: "GRANTED",
          },
        },
        [`GET /workspaces/${PERSONAL}`]: { data: { organizationId: null } },
      })[request] ?? core(request),
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
  "GET /users/{id}/organizations": {
    argv: [...API, "workspaces", "list", "--json"],
  },
  "GET /users/{id}/workspaces": {
    argv: [...API, "workspaces", "list", "--personal", "--json"],
  },
  "GET /organizations/{id}/members/me/seat": {
    argv: [...API, "workspaces", "check", "org-1", "--json"],
  },
};
