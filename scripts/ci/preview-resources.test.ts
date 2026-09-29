import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanupClosedPreview,
  previewCleanupInventory,
  renewOpenPreview,
  resolvePreviewPullNumber,
} from "./preview-lifecycle.ts";
import { preparePreviewResources } from "./preview-resources.ts";
import { deployTargets, runPreviewDeployComment } from "./vercel-deploy.mjs";

interface Branch {
  id: string;
  name: string;
  default: boolean;
  protected: boolean;
  parent_id?: string;
  expires_at?: string;
}

function setup() {
  const calls: { url: URL; method: string; body: Record<string, string> }[] =
    [];
  const branches: Branch[] = [
    { id: "br-production", name: "main", default: true, protected: true },
  ];
  const envs: Record<string, unknown>[] = [];
  const deployments: Record<string, unknown>[] = [];
  const pull = {
    number: 7,
    state: "open",
    head: { ref: "feat/x", sha: "abc", repo: { id: 99 } },
    base: { repo: { id: 99 } },
  };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ url, method, body });
    const json = (value: unknown) => Response.json(value);
    if (url.host === "api.github.com") return json(pull);
    if (url.host === "console.neon.tech") {
      if (url.pathname.endsWith("/branches")) {
        if (method === "POST") {
          const branch = {
            id: "br-preview",
            default: false,
            protected: false,
            ...body.branch,
          };
          branches.push(branch);
          return json({ branch });
        }
        const search = url.searchParams.get("search") ?? "";
        return json({
          branches: branches.filter(
            (branch) =>
              branch.name.includes(search) &&
              (!url.pathname.includes("neon-mainnet") || branch.default),
          ),
        });
      }
      if (url.pathname.endsWith("/connection_uri")) {
        return json({
          uri:
            url.searchParams.get("pooled") === "true"
              ? "postgres://preview-pooled"
              : "postgres://preview-direct",
        });
      }
      const index = branches.findIndex((branch) =>
        url.pathname.endsWith(`/${branch.id}`),
      );
      assert.notEqual(index, -1, url.pathname);
      if (method === "DELETE") branches.splice(index, 1);
      else if (method === "PATCH") {
        assert.deepEqual(Object.keys(body), ["branch"]);
        assert.equal(typeof body.branch.expires_at, "string");
        Object.assign(branches[index], body.branch);
      } else assert.fail(`Unexpected Neon call ${method} ${url.pathname}`);
      return json({});
    }
    if (url.pathname.endsWith("/env")) {
      if (method === "GET") return json({ envs });
      assert.equal(url.searchParams.get("upsert"), "true");
      const index = envs.findIndex(
        (env) => env.key === body.key && env.gitBranch === body.gitBranch,
      );
      const env = { id: `env-${body.key}`, ...body };
      if (index < 0) envs.push(env);
      else envs[index] = env;
      return json({ created: env });
    }
    if (url.pathname === "/v7/deployments") return json({ deployments });
    if (url.pathname === "/v13/deployments" && method === "POST") {
      const deployment = {
        id: `dpl-${deployments.length}`,
        uid: `dpl-${deployments.length}`,
        readyState: "READY",
        target: "preview",
        ...body,
      };
      deployments.push(deployment);
      return json(deployment);
    }
    if (method === "DELETE") return json({});
    assert.fail(`Unexpected Vercel call ${method} ${url.pathname}`);
  };
  const options = {
    repoId: 99,
    pullNumber: 7,
    ref: "feat/x",
    repoOwner: "owner",
    repoName: "repo",
    vercelToken: "vercel-key",
    teamId: "team-test",
    githubToken: "github-key",
    neonEnv: {
      NEON_API_KEY: "neon-key",
      NEON_PREVIEW_PROJECT_ID_PREPROD: "neon-preprod",
      NEON_PREVIEW_PROJECT_ID_MAINNET: "neon-mainnet",
    },
    neonFetchImpl: fetchImpl,
    fetchImpl,
  };
  return { options, calls, branches, envs, deployments, pull };
}

test("bare /deploy replies with help without touching Neon or Vercel", async () => {
  const { options, calls } = setup();
  const comments: string[] = [];
  const result = await runPreviewDeployComment({
    ...options,
    commentBody: "/deploy",
    isPullRequest: true,
    readPermission: async () => "write",
    postComment: async (body: string) => {
      comments.push(body);
    },
  });
  assert.equal(result.kind, "usage");
  assert.match(comments[0], /Usage:.*mainnet/);
  assert.deepEqual(calls, []);
});

test("new commits renew an existing preview for 24 hours without deploying", async () => {
  const { options, branches, calls } = setup();
  branches.push({
    id: "br-preview",
    name: "preview/gh-99-pr-7",
    parent_id: "br-production",
    default: false,
    protected: false,
    expires_at: new Date(Date.now() + 1000).toISOString(),
  });
  assert.deepEqual(await renewOpenPreview(options), {
    kind: "renew",
    branches: 1,
  });
  const remaining = Date.parse(branches[1].expires_at ?? "") - Date.now();
  assert.ok(
    remaining > 23.99 * 60 * 60 * 1000 && remaining <= 24 * 60 * 60 * 1000,
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(calls.every((call) => ["GET", "PATCH"].includes(call.method)));
  assert.ok(!calls.some((call) => call.url.host === "api.vercel.com"));
});

test("commits do not create previews when none exist or the database expired", async () => {
  const { options, calls } = setup();
  assert.deepEqual(await renewOpenPreview(options), {
    kind: "renew",
    branches: 0,
  });
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("queued commit renewals skip closed and fork PRs", async () => {
  for (const state of ["closed", "fork"]) {
    const { options, calls, pull } = setup();
    if (state === "closed") pull.state = "closed";
    else pull.head.repo.id = 100;
    assert.deepEqual(await renewOpenPreview(options), { kind: "skip" });
    assert.ok(calls.every((call) => call.url.host === "api.github.com"));
  }
});

test("renewal tolerates native expiry deleting a branch after lookup", async () => {
  const { options, branches } = setup();
  branches.push({
    id: "br-preview",
    name: "preview/gh-99-pr-7",
    parent_id: "br-production",
    default: false,
    protected: false,
  });
  const neonFetchImpl: typeof fetch = (input, init) =>
    init?.method === "PATCH"
      ? Promise.resolve(
          Response.json({ message: "Branch not found" }, { status: 404 }),
        )
      : options.neonFetchImpl(input, init);
  assert.deepEqual(await renewOpenPreview({ ...options, neonFetchImpl }), {
    kind: "renew",
    branches: 0,
  });
});

test("/deploy preprod provisions preprod before deployment and reuses its DB on the next request", async () => {
  const { options, calls, branches, envs, deployments, pull } = setup();
  const command = {
    ...options,
    commentBody: "/deploy preprod",
    isPullRequest: true,
    commentAuthor: "alice",
    readPermission: async () => "write",
    readPullRequest: async () => pull,
    listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
    postComment: async () => {},
    addReaction: async () => {},
  };
  await runPreviewDeployComment(command);
  await runPreviewDeployComment(command);
  assert.equal(branches.length, 2);
  assert.equal(branches[1].name, "preview/gh-99-pr-7");
  const remaining = Date.parse(branches[1].expires_at ?? "") - Date.now();
  assert.ok(
    remaining > 23.99 * 60 * 60 * 1000 && remaining <= 24 * 60 * 60 * 1000,
  );
  assert.equal(deployments.length, 4);
  assert.equal(envs.length, 2);
  assert.ok(
    envs.every(
      (env) =>
        env.gitBranch === "feat/x" &&
        JSON.stringify(env.target) === '["preview"]',
    ),
  );
  assert.equal(
    envs.find((env) => env.key === "DATABASE_URL_UNPOOLED")?.value,
    "postgres://preview-direct",
  );
  assert.ok(
    deployments.every(
      (deployment) =>
        JSON.stringify(deployment.meta) ===
        '{"sokosumiPreviewRepo":"99","sokosumiPreviewPr":"7"}',
    ),
  );
  const firstDeploy = calls.findIndex(
    (call) => call.url.pathname === "/v13/deployments",
  );
  assert.equal(
    calls
      .slice(0, firstDeploy)
      .filter(
        (call) => call.method === "POST" && call.url.pathname.endsWith("/env"),
      ).length,
    2,
  );
  assert.ok(!calls.some((call) => call.url.pathname.includes("neon-mainnet")));
  assert.ok(
    !calls.some(
      (call) =>
        call.method === "POST" && call.url.pathname.endsWith("/restore"),
    ),
  );
});

test("closed PRs cannot recreate previews, and unprivileged commenters cannot provision", async () => {
  for (const permission of ["write", "read"]) {
    const { options, calls, pull } = setup();
    pull.state = "closed";
    const result = await runPreviewDeployComment({
      ...options,
      commentBody: "/deploy preprod",
      isPullRequest: true,
      readPermission: async () => permission,
      readPullRequest: async () => pull,
      postComment: async () => {},
    });
    assert.equal(result.kind, permission === "write" ? "closed" : "denied");
    assert.deepEqual(calls, []);
  }
});

test("provision refuses an unprotected default parent before creating a branch", async () => {
  const { options, calls, branches } = setup();
  branches[0].protected = false;
  await assert.rejects(
    preparePreviewResources(options, deployTargets(["preprod"])),
    /must be protected/,
  );
  assert.equal(branches.length, 1);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("a Neon failure does not include the project path", async () => {
  const { options } = setup();
  const neonFetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/branches") && (init?.method ?? "GET") === "GET")
      return options.neonFetchImpl(input, init);
    return Promise.resolve(Response.json({ message: "nope" }, { status: 500 }));
  };
  await assert.rejects(
    preparePreviewResources(
      { ...options, neonFetchImpl },
      deployTargets(["preprod"]),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Neon answered 500: nope/);
      assert.doesNotMatch(error.message, /neon-preprod|\/branches/);
      return true;
    },
  );
});

test("integration-owned preview credentials block provisioning before any Neon mutation", async () => {
  const { options, calls, envs } = setup();
  envs.push({
    key: "DATABASE_URL",
    target: ["preview"],
    configurationId: "neon-integration",
  });
  await assert.rejects(
    preparePreviewResources(options, deployTargets(["preprod"])),
    /Disable the Neon integration/,
  );
  assert.ok(
    calls.every(
      (call) => call.method === "GET" && call.url.host === "api.vercel.com",
    ),
  );
});

test("a failed credential write never starts a Vercel deployment and does not disclose its response", async () => {
  const { options, pull, calls } = setup();
  const fetchImpl: typeof fetch = (url, init) =>
    init?.method === "POST" && String(url).includes("/env?")
      ? Promise.resolve(
          Response.json(
            { error: "postgres://private-password" },
            { status: 400 },
          ),
        )
      : options.fetchImpl(url, init);
  const comments: string[] = [];
  await assert.rejects(
    runPreviewDeployComment({
      ...options,
      fetchImpl,
      commentBody: "/deploy preprod",
      isPullRequest: true,
      readPermission: async () => "write",
      readPullRequest: async () => pull,
      listFiles: async () => [{ filename: "packages/database/package.json" }],
      postComment: async (body: string) => {
        comments.push(body);
      },
      addReaction: async () => {},
    }),
    /Vercel POST.*failed \(400\)/,
  );
  assert.ok(!calls.some((call) => call.url.pathname === "/v13/deployments"));
  assert.doesNotMatch(comments.join("\n"), /private-password/);
});

test("close cleanup deletes only owned previews, keeps production and legacy branches, and skips reopened PRs", async () => {
  const { options, calls, branches, deployments, pull, envs } = setup();
  await preparePreviewResources(options, deployTargets(["preprod"]));
  branches.push({
    id: "br-legacy",
    name: "preview/feat/x",
    parent_id: "br-production",
    default: false,
    protected: false,
  });
  const meta = { sokosumiPreviewRepo: "99", sokosumiPreviewPr: "7" };
  deployments.push(
    { uid: "dpl-ours", target: "preview", meta },
    { uid: "dpl-production", target: "production", meta },
    {
      uid: "dpl-other",
      target: "preview",
      meta: { ...meta, sokosumiPreviewPr: "8" },
    },
  );
  envs.push({
    id: "env-prod",
    key: "DATABASE_URL",
    target: ["production"],
    comment: "GitHub-managed preview/gh-99-pr-7",
  });
  assert.equal((await cleanupClosedPreview(options)).kind, "skip");
  assert.ok(!calls.some((call) => call.method === "DELETE"));
  pull.state = "closed";
  await cleanupClosedPreview(options);
  const removed = calls
    .filter((call) => call.method === "DELETE")
    .map((call) => call.url.pathname);
  assert.ok(removed.includes("/v13/deployments/dpl-ours"));
  assert.ok(removed.some((path) => path.endsWith("/branches/br-preview")));
  assert.ok(
    !removed.some((path) =>
      /dpl-production|dpl-other|env-prod|br-production|br-legacy/.test(path),
    ),
  );
  assert.deepEqual(
    branches.map((branch) => branch.id),
    ["br-production", "br-legacy"],
  );
  // Expired DBs are still found through their Vercel environment ownership marker.
  assert.deepEqual(await previewCleanupInventory(options), [7]);
});

test("cleanup deletes owned credentials after the git branch is renamed", async () => {
  const { options, calls, envs, pull } = setup();
  pull.state = "closed";
  pull.head.ref = "feat/new";
  envs.push(
    {
      id: "env-old",
      key: "DATABASE_URL",
      target: ["preview"],
      gitBranch: "feat/old",
      comment: "GitHub-managed preview/gh-99-pr-7",
    },
    {
      id: "env-prod",
      key: "DATABASE_URL",
      target: ["production"],
      gitBranch: "feat/old",
      comment: "GitHub-managed preview/gh-99-pr-7",
    },
  );
  await cleanupClosedPreview(options);
  const removed = calls
    .filter((call) => call.method === "DELETE")
    .map((call) => call.url.pathname);
  assert.ok(removed.some((path) => path.endsWith("/env/env-old")));
  assert.ok(!removed.some((path) => path.endsWith("/env/env-prod")));
});

test("cleanup refuses a protected branch before deleting anything", async () => {
  const { options, calls, branches, pull } = setup();
  branches.push({
    id: "br-locked",
    name: "preview/gh-99-pr-7",
    parent_id: "br-production",
    default: false,
    protected: true,
  });
  pull.state = "closed";
  await assert.rejects(cleanupClosedPreview(options), /protected\/default/);
  assert.ok(!calls.some((call) => call.method === "DELETE"));
});

test("daily inventory skips a missing PR and still includes later closed PRs", async () => {
  const { options, envs, pull, calls } = setup();
  envs.push(
    { comment: "GitHub-managed preview/gh-99-pr-6" },
    { comment: "GitHub-managed preview/gh-99-pr-7" },
  );
  const lookedUp: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== "api.github.com") return options.fetchImpl(input, init);
    const number = Number(url.pathname.split("/").at(-1));
    lookedUp.push(number);
    return number === 6
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json({ ...pull, state: "closed" });
  };
  assert.deepEqual(
    await previewCleanupInventory({ ...options, fetchImpl }),
    [7],
  );
  assert.deepEqual(lookedUp, [6, 7]);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("daily inventory still fails on GitHub authorization and service errors", async () => {
  for (const status of [401, 403, 429, 500]) {
    const { options, envs } = setup();
    envs.push({ comment: "GitHub-managed preview/gh-99-pr-7" });
    const fetchImpl: typeof fetch = async (input, init) => {
      if (new URL(String(input)).host !== "api.github.com")
        return options.fetchImpl(input, init);
      return Response.json({ message: "Request failed" }, { status });
    };
    await assert.rejects(
      previewCleanupInventory({ ...options, fetchImpl }),
      new RegExp(`GitHub ${status}`),
    );
  }
});

test("daily inventory skips open PRs and drains a backlog in bounded batches", async () => {
  const { options, envs, pull } = setup();
  for (let number = 1; number <= 261; number++) {
    envs.push({ comment: `GitHub-managed preview/gh-99-pr-${number}` });
  }
  const lookedUp: number[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.host !== "api.github.com") return options.fetchImpl(input, init);
    const number = Number(url.pathname.split("/").at(-1));
    lookedUp.push(number);
    return Promise.resolve(
      Response.json({
        ...pull,
        number,
        state: number === 1 ? "open" : "closed",
      }),
    );
  };
  const inventory = await previewCleanupInventory({ ...options, fetchImpl });
  assert.equal(inventory.length, 256);
  assert.equal(inventory[0], 2);
  assert.equal(inventory.at(-1), 257);
  assert.equal(lookedUp.at(-1), 257);
});

test("resolvePreviewPullNumber prefers PREVIEW_PR_NUMBER then the event payload", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected ${input}`);
  };
  assert.equal(
    await resolvePreviewPullNumber({
      event: { pull_request: { number: 4 } },
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      env: { PREVIEW_PR_NUMBER: "12" },
      fetchImpl,
    }),
    12,
  );
  assert.equal(
    await resolvePreviewPullNumber({
      event: {
        workflow_run: { pull_requests: [{ number: 9 }] },
      },
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      env: {},
      fetchImpl,
    }),
    9,
  );
  assert.deepEqual(calls, []);
});

test("resolvePreviewPullNumber looks up the workflow run then commit pulls", async () => {
  const repo = "acme/sokosumi";
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/actions/runs/99")) {
      return Response.json({ pull_requests: [] });
    }
    if (url.endsWith("/commits/abc123/pulls")) {
      return Response.json([
        {
          number: 2,
          head: { sha: "abc123", repo: { full_name: "evil/fork" } },
        },
        { number: 4, head: { sha: "def456", repo: { full_name: repo } } },
        { number: 3, head: { sha: "abc123", repo: { full_name: repo } } },
      ]);
    }
    throw new Error(`unexpected ${url}`);
  };
  assert.equal(
    await resolvePreviewPullNumber({
      event: { workflow_run: { id: 99, head_sha: "abc123" } },
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      env: {},
      fetchImpl,
    }),
    3,
  );
});

test("resolvePreviewPullNumber resolves an unmerged close from display_title bound to the head SHA", async () => {
  // Real GitHub: closed runs list no pulls, and commits/{sha}/pulls omits
  // PRs closed without merging. Only the signal run-name identifies the PR.
  const repo = "acme/sokosumi";
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/pulls/7")) {
      return Response.json({
        number: 7,
        head: { sha: "abc123", repo: { full_name: repo } },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  assert.equal(
    await resolvePreviewPullNumber({
      event: {
        workflow_run: {
          id: 99,
          head_sha: "abc123",
          display_title: "7",
          pull_requests: [],
        },
      },
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      env: { PREVIEW_PR_NUMBER: "" },
      fetchImpl,
    }),
    7,
  );
  assert.deepEqual(calls, [`https://api.github.com/repos/${repo}/pulls/7`]);
});

test("resolvePreviewPullNumber ignores a display_title PR with another head or repo", async () => {
  const repo = "acme/sokosumi";
  for (const head of [
    { sha: "def456", repo: { full_name: repo } },
    { sha: "abc123", repo: { full_name: "evil/fork" } },
  ]) {
    await assert.rejects(
      resolvePreviewPullNumber({
        event: {
          workflow_run: { id: 99, head_sha: "abc123", display_title: "7" },
        },
        githubToken: "tok",
        repoOwner: "acme",
        repoName: "sokosumi",
        env: {},
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith("/pulls/7")) return Response.json({ head });
          if (url.endsWith("/actions/runs/99")) {
            return Response.json({ pull_requests: [] });
          }
          if (url.endsWith("/commits/abc123/pulls")) return Response.json([]);
          throw new Error(`unexpected ${url}`);
        },
      }),
      /A valid PR number is required/,
    );
  }
});

test("resolvePreviewPullNumber fails when commit pulls are not a unique head SHA match", async () => {
  const repo = "acme/sokosumi";
  const options = {
    event: { workflow_run: { head_sha: "abc123" } },
    githubToken: "tok",
    repoOwner: "acme",
    repoName: "sokosumi",
    env: {},
  };
  await assert.rejects(
    resolvePreviewPullNumber({
      ...options,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/commits/abc123/pulls")) {
          return Response.json([
            { number: 4, head: { sha: "def456", repo: { full_name: repo } } },
          ]);
        }
        throw new Error(`unexpected ${url}`);
      },
    }),
    /A valid PR number is required/,
  );
  await assert.rejects(
    resolvePreviewPullNumber({
      ...options,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/commits/abc123/pulls")) {
          return Response.json([
            { number: 3, head: { sha: "abc123", repo: { full_name: repo } } },
            { number: 5, head: { sha: "abc123", repo: { full_name: repo } } },
          ]);
        }
        throw new Error(`unexpected ${url}`);
      },
    }),
    /A valid PR number is required/,
  );
});

test("resolvePreviewPullNumber fails when no PR can be resolved", async () => {
  await assert.rejects(
    resolvePreviewPullNumber({
      event: {},
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      env: {},
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    }),
    /A valid PR number is required/,
  );
});
