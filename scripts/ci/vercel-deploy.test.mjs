import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createGitDeployment,
  deployTargets,
  GITHUB_PR_FILES_LIMIT,
  hasPreviewRelevantChanges,
  isPreviewRelevantPath,
  isTruncatedFileList,
  isWritePermission,
  listPullRequestFiles,
  noPreviewChangesMessage,
  parseDeployComment,
  pollDeploymentUntilSettled,
  runPreviewDeployComment,
  runPreviewFromGithubEvent,
  settlePreviewDeployments,
  summarizeCliDeployResult,
  usageMessage,
  VERCEL_PROJECTS,
  VERCEL_TEAM_ID,
} from "./vercel-deploy.mjs";

const GIT_DEPLOYMENT_ENABLED = {
  "*": false,
  "**": false,
  main: true,
};

const repoRoot = path.resolve(import.meta.dirname, "../..");

function jobBlock(yaml, jobId) {
  const match = yaml.match(
    new RegExp(`(?:^|\\n)  ${jobId}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z]|$)`),
  );
  assert.ok(match, `missing job ${jobId}`);
  return match[0];
}

function checkoutStep(jobYaml, jobId) {
  const afterName = jobYaml.split(/- name: Checkout repository\n/)[1];
  assert.ok(afterName, `${jobId} missing Checkout repository step`);
  return afterName.split(/\n      - name:/)[0];
}

describe("parseDeployComment", () => {
  it("ignores comments that are not a leading /deploy command", () => {
    assert.deepEqual(parseDeployComment("please deploy this"), {
      kind: "ignore",
    });
    assert.deepEqual(parseDeployComment("please\n/deploy mainnet"), {
      kind: "ignore",
    });
    assert.deepEqual(parseDeployComment("/deploy-mainnet"), { kind: "ignore" });
    assert.deepEqual(parseDeployComment(""), { kind: "ignore" });
  });

  it("returns help when no network is specified", () => {
    assert.deepEqual(parseDeployComment("/deploy"), { kind: "usage" });
    assert.deepEqual(parseDeployComment("  /deploy  \nthanks"), {
      kind: "usage",
    });
  });

  it("returns usage for unknown or extra tokens", () => {
    assert.deepEqual(parseDeployComment("/deploy both"), { kind: "usage" });
    assert.deepEqual(parseDeployComment("/deploy mainnet please"), {
      kind: "usage",
    });
    assert.deepEqual(parseDeployComment("/deploy staging"), { kind: "usage" });
    // The plain /deploy job never deploys a `--reset-db` comment without the
    // reset.
    assert.deepEqual(parseDeployComment("/deploy all --reset-db"), {
      kind: "usage",
    });
    assert.deepEqual(parseDeployComment("/deploy all mainnet"), {
      kind: "usage",
    });
    assert.deepEqual(parseDeployComment("/deploy all preprod"), {
      kind: "usage",
    });
  });

  it("parses one or both networks from the first line", () => {
    assert.deepEqual(parseDeployComment("/deploy mainnet"), {
      kind: "deploy",
      networks: ["mainnet"],
    });
    assert.deepEqual(parseDeployComment("/deploy preprod"), {
      kind: "deploy",
      networks: ["preprod"],
    });
    assert.deepEqual(parseDeployComment("/deploy mainnet preprod"), {
      kind: "deploy",
      networks: ["mainnet", "preprod"],
    });
    assert.deepEqual(parseDeployComment("/deploy preprod mainnet"), {
      kind: "deploy",
      networks: ["mainnet", "preprod"],
    });
    assert.deepEqual(parseDeployComment("/Deploy MAINNET"), {
      kind: "deploy",
      networks: ["mainnet"],
    });
    assert.deepEqual(parseDeployComment("/deploy mainnet mainnet"), {
      kind: "deploy",
      networks: ["mainnet"],
    });
    assert.deepEqual(parseDeployComment("/deploy all"), {
      kind: "deploy",
      networks: ["mainnet", "preprod"],
    });
    assert.deepEqual(parseDeployComment("/deploy ALL"), {
      kind: "deploy",
      networks: ["mainnet", "preprod"],
    });
  });
});

describe("isWritePermission", () => {
  it("allows admin, maintain, and write", () => {
    assert.equal(isWritePermission("admin"), true);
    assert.equal(isWritePermission("maintain"), true);
    assert.equal(isWritePermission("write"), true);
  });

  it("rejects read, triage, and missing", () => {
    assert.equal(isWritePermission("read"), false);
    assert.equal(isWritePermission("triage"), false);
    assert.equal(isWritePermission("none"), false);
    assert.equal(isWritePermission(undefined), false);
  });
});

describe("usageMessage", () => {
  it("lists the four commands and does not deploy on its own", () => {
    const message = usageMessage();
    assert.match(
      message,
      /`\/deploy <mainnet\|preprod> \[mainnet\|preprod\]` or `\/deploy all`/,
    );
    assert.doesNotMatch(message, /<mainnet\|preprod\|all>/);
    assert.match(message, /\/deploy mainnet/);
    assert.match(message, /\/deploy preprod/);
    assert.match(message, /\/deploy mainnet preprod/);
    assert.match(message, /\/deploy all/);
    assert.match(message, /CMO on mainnet/);
    assert.doesNotMatch(message, /@vercel/);
  });
});

describe("deployTargets", () => {
  it("always deploys web and core together per network, and CMO on mainnet", () => {
    const mainnet = deployTargets(["mainnet"]);
    assert.deepEqual(
      mainnet.map((target) => `${target.network}:${target.app}`),
      ["mainnet:web", "mainnet:core", "mainnet:cmo"],
    );
    assert.equal(mainnet[0].projectId, VERCEL_PROJECTS.mainnet.web.id);
    assert.equal(mainnet[1].projectId, VERCEL_PROJECTS.mainnet.core.id);
    assert.equal(mainnet[2].projectId, VERCEL_PROJECTS.mainnet.cmo.id);

    const both = deployTargets(["mainnet", "preprod"]);
    assert.deepEqual(
      both.map((target) => `${target.network}:${target.app}`),
      [
        "mainnet:web",
        "mainnet:core",
        "mainnet:cmo",
        "preprod:web",
        "preprod:core",
      ],
    );
    assert.equal(both[3].projectId, VERCEL_PROJECTS.preprod.web.id);
    assert.equal(both[4].projectId, VERCEL_PROJECTS.preprod.core.id);
  });

  it("limits targets to the named apps", () => {
    assert.deepEqual(
      deployTargets(["mainnet", "preprod"], ["core"]).map(
        (target) => `${target.network}:${target.app}`,
      ),
      ["mainnet:core", "preprod:core"],
    );
  });
});

describe("project ids", () => {
  it("matches relatedProjects in vercel.json", async () => {
    const web = JSON.parse(
      await readFile(path.join(repoRoot, "apps/web/vercel.json"), "utf8"),
    );
    const core = JSON.parse(
      await readFile(path.join(repoRoot, "apps/core/vercel.json"), "utf8"),
    );

    assert.ok(web.relatedProjects.includes(VERCEL_PROJECTS.mainnet.core.id));
    assert.ok(web.relatedProjects.includes(VERCEL_PROJECTS.preprod.core.id));
    assert.ok(core.relatedProjects.includes(VERCEL_PROJECTS.mainnet.web.id));
    assert.ok(core.relatedProjects.includes(VERCEL_PROJECTS.preprod.web.id));
    assert.match(VERCEL_TEAM_ID, /^team_/);
  });

  it("holds real Vercel project ids", () => {
    // `/deploy` and PR cleanup run this map from main; one unknown id fails
    // them for every pull request.
    for (const network of Object.values(VERCEL_PROJECTS)) {
      for (const project of Object.values(network)) {
        assert.match(project.id, /^prj_[A-Za-z0-9]{28}$/, project.name);
      }
    }
  });

  it("deploys CMO like web", async () => {
    const web = JSON.parse(
      await readFile(path.join(repoRoot, "apps/web/vercel.json"), "utf8"),
    );
    const cmo = JSON.parse(
      await readFile(path.join(repoRoot, "apps/cmo/vercel.json"), "utf8"),
    );

    assert.equal(
      cmo.installCommand,
      "pnpm install --frozen-lockfile --filter cmo...",
    );
    assert.deepEqual(cmo.git, web.git);
  });
});

describe("createGitDeployment", () => {
  it("creates a preview git deployment with forceNew", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          id: "dpl_1",
          url: "sokosumi-app-mainnet-abc.vercel.app",
          inspectorUrl: "https://vercel.com/inspect/dpl_1",
          readyState: "QUEUED",
        }),
      };
    };

    const target = deployTargets(["mainnet"])[0];
    const deployment = await createGitDeployment({
      token: "tok",
      teamId: VERCEL_TEAM_ID,
      target,
      repoId: 123,
      ref: "feat/preview",
      sha: "abc123",
      fetchImpl,
    });

    assert.equal(deployment.id, "dpl_1");
    assert.equal(calls.length, 1);
    const posted = new URL(calls[0].url);
    assert.equal(posted.origin, "https://api.vercel.com");
    assert.equal(posted.pathname, "/v13/deployments");
    assert.equal(posted.searchParams.get("forceNew"), "1");
    assert.equal(posted.searchParams.get("teamId"), VERCEL_TEAM_ID);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.project, target.projectId);
    assert.equal(body.name, target.name);
    assert.equal(body.gitSource.type, "github");
    assert.equal(body.gitSource.repoId, 123);
    assert.equal(body.gitSource.ref, "feat/preview");
    assert.equal(body.gitSource.sha, "abc123");
    assert.equal(body.target, undefined);
  });

  it("puts Vercel's error code and message in the thrown error", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "bad_request", message: "Invalid preview suffix" },
      }),
    });
    const target = deployTargets(["mainnet"], ["cmo"])[0];

    await assert.rejects(
      createGitDeployment({
        token: "tok",
        teamId: VERCEL_TEAM_ID,
        target,
        repoId: 123,
        ref: "feat/preview",
        sha: "abc123",
        fetchImpl,
      }),
      {
        message:
          "Vercel deploy failed for sokosumi-cmo (400): bad_request: Invalid preview suffix",
      },
    );
  });

  it("keeps the status when the error body is not JSON", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    await assert.rejects(
      createGitDeployment({
        token: "tok",
        teamId: VERCEL_TEAM_ID,
        target: deployTargets(["mainnet"], ["web"])[0],
        repoId: 123,
        ref: "feat/preview",
        sha: "abc123",
        fetchImpl,
      }),
      { message: "Vercel deploy failed for sokosumi-app-mainnet (502)" },
    );
  });
});

describe("runPreviewDeployComment", () => {
  it("no-ops when the comment is not on a pull request", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: false,
      postComment: async (body) => {
        posted.push(body);
      },
    });
    assert.equal(result.kind, "ignore");
    assert.deepEqual(posted, []);
  });

  it("replies with usage for an invalid network", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy invalid",
      isPullRequest: true,
      commentAuthor: "alice",
      readPermission: async () => "write",
      postComment: async (body) => {
        posted.push(body);
      },
    });
    assert.equal(result.kind, "usage");
    assert.equal(posted.length, 1);
    assert.match(posted[0], /\/deploy mainnet preprod/);
  });

  it("refuses commenters without write access", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "outsider",
      readPermission: async () => "read",
      postComment: async (body) => {
        posted.push(body);
      },
    });
    assert.equal(result.kind, "denied");
    assert.match(posted[0], /write access/i);
  });

  it("refuses fork pull requests", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "alice",
      readPermission: async () => "write",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "abc", ref: "feat", repo: { id: 2, fork: true } },
        base: { repo: { id: 1 } },
      }),
      postComment: async (body) => {
        posted.push(body);
      },
    });
    assert.equal(result.kind, "fork");
    assert.match(posted[0], /fork/i);
  });

  it("refuses pull requests whose head repo is missing", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "alice",
      readPermission: async () => "write",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "abc", ref: "feat", repo: null },
        base: { repo: { id: 1 } },
      }),
      postComment: async (body) => {
        posted.push(body);
      },
    });
    assert.equal(result.kind, "fork");
    assert.match(posted[0], /fork/i);
  });

  it("creates web, core, and CMO previews for mainnet", async () => {
    const posted = [];
    const reactions = [];
    const created = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "alice",
      repoId: 99,
      readPermission: async () => "admin",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99, fork: false } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "apps/web/app/page.tsx" }],
      prepareResources: async () => {},
      createDeployment: async (input) => {
        created.push(input);
        return {
          id: `dpl_${input.target.app}`,
          url: `${input.target.name}.vercel.app`,
          inspectorUrl: `https://vercel.com/${input.target.name}`,
          alias: [`${input.target.name}-git-feat-x.preview.sokosumi.com`],
          readyState: "READY",
        };
      },
      pollDeployment: async (deployment) => deployment,
      postComment: async (body) => {
        posted.push(body);
      },
      addReaction: async (content) => {
        reactions.push(content);
      },
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 3);
    assert.deepEqual(
      created.map((item) => item.target.app),
      ["web", "core", "cmo"],
    );
    assert.equal(created[0].sha, "deadbeef");
    assert.equal(created[0].ref, "feat/x");
    assert.equal(created[0].repoId, 99);
    assert.deepEqual(posted, []);
    assert.deepEqual(reactions, ["eyes", "rocket"]);
  });

  it("reacts eyes then rocket on the triggering comment via the GitHub API", async () => {
    const calls = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "alice",
      commentId: 4242,
      repoOwner: "acme",
      repoName: "sokosumi",
      githubToken: "tok",
      repoId: 99,
      readPermission: async () => "write",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99, fork: false } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "packages/utils/src/index.ts" }],
      prepareResources: async () => {},
      createDeployment: async (input) => ({
        id: `dpl_${input.target.app}`,
        readyState: "READY",
      }),
      pollDeployment: async (deployment) => deployment,
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: init?.body,
        });
        return {
          ok: true,
          json: async () => ({ id: 1, content: "rocket" }),
        };
      },
    });
    assert.equal(result.kind, "deploy");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.method === "POST"));
    assert.ok(
      calls.every(
        (call) =>
          call.url ===
          "https://api.github.com/repos/acme/sokosumi/issues/comments/4242/reactions",
      ),
    );
    assert.deepEqual(JSON.parse(calls[0].body), { content: "eyes" });
    assert.deepEqual(JSON.parse(calls[1].body), { content: "rocket" });
  });

  it("comments when creating a deployment fails", async () => {
    const posted = [];
    const reactions = [];
    await assert.rejects(
      () =>
        runPreviewDeployComment({
          commentBody: "/deploy mainnet",
          isPullRequest: true,
          commentAuthor: "alice",
          repoId: 99,
          readPermission: async () => "write",
          readPullRequest: async () => ({
            state: "open",
            number: 12,
            head: { sha: "abc", ref: "feat", repo: { id: 99 } },
            base: { repo: { id: 99 } },
          }),
          listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
          prepareResources: async () => {},
          createDeployment: async () => {
            throw new Error("nope");
          },
          postComment: async (body) => {
            posted.push(body);
          },
          addReaction: async (content) => {
            reactions.push(content);
          },
        }),
      /nope/,
    );
    assert.match(posted[0], /Preview deploy failed: nope/);
    assert.deepEqual(reactions, ["eyes"]);
  });

  it("comments when a preview deployment is not READY", async () => {
    const posted = [];
    const reactions = [];
    await assert.rejects(
      () =>
        runPreviewDeployComment({
          commentBody: "/deploy mainnet",
          isPullRequest: true,
          commentAuthor: "alice",
          repoId: 99,
          readPermission: async () => "write",
          readPullRequest: async () => ({
            state: "open",
            number: 12,
            head: { sha: "abc", ref: "feat", repo: { id: 99 } },
            base: { repo: { id: 99 } },
          }),
          listFiles: async () => ["apps/web/app/page.tsx"],
          prepareResources: async () => {},
          createDeployment: async (input) => ({
            id: `dpl_${input.target.app}`,
            readyState: input.target.app === "core" ? "ERROR" : "READY",
          }),
          pollDeployment: async (deployment) => deployment,
          postComment: async (body) => {
            posted.push(body);
          },
          addReaction: async (content) => {
            reactions.push(content);
          },
        }),
      /sokosumi-core-mainnet \(ERROR\)/,
    );
    assert.match(
      posted[0],
      /Preview deploy failed: sokosumi-core-mainnet \(ERROR\)/,
    );
    assert.deepEqual(reactions, ["eyes"]);
  });
});

describe("pollDeploymentUntilSettled", () => {
  it("polls until the deployment is READY", async () => {
    const calls = [];
    const result = await pollDeploymentUntilSettled({
      deployment: { id: "dpl_1", readyState: "QUEUED" },
      token: "tok",
      teamId: VERCEL_TEAM_ID,
      timeoutMs: 60_000,
      intervalMs: 1,
      sleep: async () => {},
      fetchImpl: async () => {
        calls.push(true);
        return {
          ok: true,
          json: async () => ({
            id: "dpl_1",
            url: "x.vercel.app",
            readyState: "READY",
          }),
        };
      },
    });
    assert.equal(result.readyState, "READY");
    assert.equal(calls.length, 1);
  });

  it("keeps the last known deployment when a poll response is not ok", async () => {
    const urls = [];
    const result = await pollDeploymentUntilSettled({
      deployment: { id: "dpl_1", readyState: "QUEUED" },
      token: "tok",
      teamId: VERCEL_TEAM_ID,
      timeoutMs: 60_000,
      intervalMs: 1,
      sleep: async () => {},
      fetchImpl: async (url) => {
        urls.push(String(url));
        if (urls.length === 1) {
          return { ok: false, json: async () => ({ error: "rate limit" }) };
        }
        return {
          ok: true,
          json: async () => ({ id: "dpl_1", readyState: "READY" }),
        };
      },
    });
    assert.equal(result.readyState, "READY");
    assert.equal(urls.length, 2);
    assert.match(urls[1], /\/dpl_1/);
  });

  it("treats BLOCKED as terminal", async () => {
    const result = await pollDeploymentUntilSettled({
      deployment: { id: "dpl_1", readyState: "BLOCKED" },
      token: "tok",
      teamId: VERCEL_TEAM_ID,
      fetchImpl: async () => {
        throw new Error("should not poll");
      },
    });
    assert.equal(result.readyState, "BLOCKED");
  });

  it("throws when polling times out", async () => {
    await assert.rejects(
      () =>
        pollDeploymentUntilSettled({
          deployment: { id: "dpl_1", readyState: "QUEUED" },
          token: "tok",
          teamId: VERCEL_TEAM_ID,
          timeoutMs: 0,
          intervalMs: 1,
          sleep: async () => {},
          fetchImpl: async () => {
            throw new Error("should not poll");
          },
        }),
      /did not finish/,
    );
  });
});

describe("settlePreviewDeployments", () => {
  // A job that ends early releases the per-PR queue while a Core build it
  // started can still migrate, and a queued reset could then restore the
  // branch under it.
  function deferred() {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  async function settledBefore(promise, release) {
    let done = false;
    const watched = promise.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const early = done;
    release();
    await watched;
    return early;
  }

  it("waits for every poll before it reports a failed one", async () => {
    const core = deferred();
    const run = settlePreviewDeployments({
      networks: ["mainnet"],
      git: {},
      prepareResources: async () => {},
      createDeployment: async ({ target }) => ({
        id: target.app,
        readyState: "BUILDING",
      }),
      pollDeployment: async (deployment) => {
        if (deployment.id === "web") {
          throw new Error("fetch failed");
        }
        await core.promise;
        return { ...deployment, readyState: "READY" };
      },
    });
    assert.equal(await settledBefore(run, core.resolve), false);
    await assert.rejects(run, /fetch failed/);
  });

  it("polls the created deployments, then reports the first failure", async () => {
    const core = deferred();
    const polled = [];
    const run = settlePreviewDeployments({
      networks: ["mainnet"],
      git: {},
      prepareResources: async () => {},
      createDeployment: async ({ target }) => {
        if (target.app === "web") {
          throw new Error("Vercel 500");
        }
        return { id: target.app, readyState: "BUILDING" };
      },
      pollDeployment: async (deployment) => {
        polled.push(deployment.id);
        await core.promise;
        throw new Error("poll failed");
      },
    });
    assert.equal(await settledBefore(run, core.resolve), false);
    // web comes first in the target order, so its create error wins.
    await assert.rejects(run, /Vercel 500/);
    assert.deepEqual(polled, ["core", "cmo"]);
  });
});

describe("runPreviewFromGithubEvent", () => {
  it("never deploys from PR open, update, reopen, or close events", async () => {
    for (const eventName of ["pull_request", "pull_request_target"]) {
      for (const action of ["opened", "synchronize", "reopened", "closed"]) {
        assert.deepEqual(
          await runPreviewFromGithubEvent({ eventName, event: { action } }),
          { kind: "ignore" },
        );
      }
    }
  });

  it("routes issue_comment events to the comment deploy", async () => {
    const created = [];
    const result = await runPreviewFromGithubEvent({
      eventName: "issue_comment",
      event: {
        action: "created",
        comment: { body: "/deploy mainnet", user: { login: "alice" }, id: 1 },
        issue: { pull_request: {}, number: 12 },
        repository: { id: 99 },
      },
      isPullRequest: true,
      commentAuthor: "alice",
      readPermission: async () => "write",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99 } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
      prepareResources: async () => {},
      createDeployment: async (input) => {
        created.push(input);
        return { id: `dpl_${input.target.app}`, readyState: "READY" };
      },
      pollDeployment: async (deployment) => deployment,
      postComment: async () => {},
      addReaction: async () => {},
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 3);
  });
});

describe("summarizeCliDeployResult", () => {
  it("keeps only id, name, and readyState from deployment payloads", () => {
    assert.deepEqual(
      summarizeCliDeployResult({
        kind: "deploy",
        deployments: [
          {
            id: "dpl_1",
            name: "sokosumi-app-mainnet",
            readyState: "READY",
            env: [{ key: "DATABASE_URL" }],
            project: { settings: { crons: [] } },
          },
        ],
      }),
      {
        kind: "deploy",
        deployments: [
          {
            id: "dpl_1",
            name: "sokosumi-app-mainnet",
            readyState: "READY",
          },
        ],
      },
    );
  });

  it("leaves results without deployments unchanged", () => {
    assert.deepEqual(summarizeCliDeployResult({ kind: "ignore" }), {
      kind: "ignore",
    });
  });
});

describe("preview change gating", () => {
  it("matches web, core, CMO, and workspace package paths", () => {
    assert.equal(isPreviewRelevantPath("apps/web/app/page.tsx"), true);
    assert.equal(isPreviewRelevantPath("apps/core/src/index.ts"), true);
    assert.equal(isPreviewRelevantPath("apps/cmo/src/app/page.tsx"), true);
    assert.equal(
      isPreviewRelevantPath("packages/database/prisma/schema.prisma"),
      true,
    );
    assert.equal(isPreviewRelevantPath("./packages/utils/src/index.ts"), true);
  });

  it("ignores docs, scripts, workflows, and repo roots", () => {
    assert.equal(isPreviewRelevantPath("docs/guide.md"), false);
    assert.equal(isPreviewRelevantPath("README.md"), false);
    assert.equal(isPreviewRelevantPath("scripts/ci/vercel-deploy.mjs"), false);
    assert.equal(
      isPreviewRelevantPath(".github/workflows/preview-deploy.yml"),
      false,
    );
    assert.equal(isPreviewRelevantPath("apps/apple/x.swift"), false);
    assert.equal(isPreviewRelevantPath("apps/web"), false);
    assert.equal(isPreviewRelevantPath(""), false);
    assert.equal(isPreviewRelevantPath(undefined), false);
    assert.equal(isPreviewRelevantPath(null), false);
  });

  it("detects relevant changes in PR file lists", () => {
    assert.equal(hasPreviewRelevantChanges([]), false);
    assert.equal(hasPreviewRelevantChanges(undefined), false);
    assert.equal(
      hasPreviewRelevantChanges([
        { filename: "docs/guide.md" },
        { filename: "README.md" },
      ]),
      false,
    );
    assert.equal(
      hasPreviewRelevantChanges([
        { filename: "docs/guide.md" },
        { filename: "packages/net/src/index.ts" },
      ]),
      true,
    );
    assert.equal(hasPreviewRelevantChanges(["apps/core/vercel.json"]), true);
  });

  it("explains the skip and how to get a preview", () => {
    const message = noPreviewChangesMessage();
    assert.match(message, /No preview deployment/);
    assert.match(message, /apps\/web/);
    assert.match(message, /apps\/core/);
    assert.match(message, /apps\/cmo/);
    assert.match(message, /packages\//);
    assert.match(message, /\/deploy <network>/);
  });

  it("covers the transitive workspace dependencies of web and core", async () => {
    const packageDir = (name) => {
      if (name === "web") {
        return "apps/web";
      }
      if (name === "@sokosumi/core") {
        return "apps/core";
      }
      assert.match(name, /^@sokosumi\//);
      return `packages/${name.slice("@sokosumi/".length)}`;
    };
    const readPackage = async (dir) =>
      JSON.parse(
        await readFile(path.join(repoRoot, dir, "package.json"), "utf8"),
      );
    const seen = new Set(["web", "@sokosumi/core"]);
    const queue = ["web", "@sokosumi/core"];
    while (queue.length > 0) {
      const name = queue.pop();
      const manifest = await readPackage(packageDir(name));
      const deps = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
      };
      for (const [dep, range] of Object.entries(deps)) {
        if (String(range).includes("workspace") && !seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
    }
    assert.ok(seen.size > 2);
    for (const name of seen) {
      assert.equal(
        isPreviewRelevantPath(`${packageDir(name)}/package.json`),
        true,
        `${name} (${packageDir(name)}) is a web/core dependency but is not preview-relevant`,
      );
    }
  });

  it("never path-filters PR-close cleanup", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/preview-deploy.yml"),
      "utf8",
    );
    const triggers = workflow.split(/^jobs:/m)[0];
    assert.match(triggers, /workflow_run:/);
    assert.match(triggers, /workflows:\s*\["PR closed", "PR synchronize"\]/);
    assert.doesNotMatch(triggers, /^\s+pull_request_target:/m);
    assert.doesNotMatch(triggers, /paths:/);
  });
});

describe("listPullRequestFiles", () => {
  it("returns one page of files without further requests", async () => {
    const calls = [];
    const files = await listPullRequestFiles({
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      pullNumber: 12,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => [{ filename: "docs/guide.md" }],
        };
      },
    });
    assert.deepEqual(
      files.map((file) => file.filename),
      ["docs/guide.md"],
    );
    assert.equal(calls.length, 1);
    const requested = new URL(calls[0]);
    assert.equal(requested.pathname, "/repos/acme/sokosumi/pulls/12/files");
  });

  it("follows pagination until a short page", async () => {
    const calls = [];
    const files = await listPullRequestFiles({
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      pullNumber: 12,
      perPage: 2,
      fetchImpl: async (url) => {
        calls.push(String(url));
        const page = Number(new URL(String(url)).searchParams.get("page"));
        return {
          ok: true,
          status: 200,
          json: async () =>
            page === 1
              ? [{ filename: "a.md" }, { filename: "b.md" }]
              : [{ filename: "apps/web/c.tsx" }],
        };
      },
    });
    assert.deepEqual(
      files.map((file) => file.filename),
      ["a.md", "b.md", "apps/web/c.tsx"],
    );
    assert.equal(calls.length, 2);
  });

  it("returns an empty list when the pull request has no files", async () => {
    const files = await listPullRequestFiles({
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      pullNumber: 12,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [],
      }),
    });
    assert.deepEqual(files, []);
  });

  it("stops paging once the GitHub file cap is reached", async () => {
    let calls = 0;
    const files = await listPullRequestFiles({
      githubToken: "tok",
      repoOwner: "acme",
      repoName: "sokosumi",
      pullNumber: 12,
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () =>
            Array.from({ length: 100 }, (_, index) => ({
              filename: `docs/page-${calls}-${index}.md`,
            })),
        };
      },
    });
    assert.equal(files.length, GITHUB_PR_FILES_LIMIT);
    assert.equal(calls, GITHUB_PR_FILES_LIMIT / 100);
    assert.equal(isTruncatedFileList(files), true);
  });

  it("flags only capped lists as truncated", () => {
    assert.equal(isTruncatedFileList([]), false);
    assert.equal(isTruncatedFileList(undefined), false);
    assert.equal(isTruncatedFileList([{ filename: "docs/guide.md" }]), false);
    assert.equal(
      isTruncatedFileList(
        Array.from({ length: GITHUB_PR_FILES_LIMIT - 1 }, () => ({
          filename: "docs/guide.md",
        })),
      ),
      false,
    );
    assert.equal(
      isTruncatedFileList(
        Array.from({ length: GITHUB_PR_FILES_LIMIT }, () => ({
          filename: "docs/guide.md",
        })),
      ),
      true,
    );
  });
});

describe("preview skip on /deploy", () => {
  function baseComment(overrides = {}) {
    return {
      commentBody: "/deploy mainnet",
      isPullRequest: true,
      commentAuthor: "alice",
      repoId: 99,
      readPermission: async () => "write",
      readPullRequest: async () => ({
        state: "open",
        number: 12,
        head: { sha: "abc", ref: "feat", repo: { id: 99 } },
        base: { repo: { id: 99 } },
      }),
      postComment: async () => {},
      addReaction: async () => {},
      ...overrides,
    };
  }

  it("skips with an explanatory comment when nothing is preview-relevant", async () => {
    const posted = [];
    const reactions = [];
    const created = [];
    const result = await runPreviewDeployComment(
      baseComment({
        listFiles: async () => [
          { filename: "docs/guide.md" },
          { filename: "README.md" },
        ],
        prepareResources: async () => {},
        createDeployment: async (input) => {
          created.push(input);
          return { id: "dpl", readyState: "READY" };
        },
        pollDeployment: async (deployment) => deployment,
        postComment: async (body) => {
          posted.push(body);
        },
        addReaction: async (content) => {
          reactions.push(content);
        },
      }),
    );
    assert.equal(result.kind, "skip");
    assert.deepEqual(created, []);
    assert.equal(posted.length, 1);
    assert.equal(posted[0], noPreviewChangesMessage());
    assert.deepEqual(reactions, ["eyes"]);
  });

  it("deploys when at least one package file changed", async () => {
    const created = [];
    const result = await runPreviewDeployComment(
      baseComment({
        listFiles: async () => [
          { filename: "docs/guide.md" },
          { filename: "packages/email/src/index.ts" },
        ],
        prepareResources: async () => {},
        createDeployment: async (input) => {
          created.push(input);
          return { id: `dpl_${input.target.app}`, readyState: "READY" };
        },
        pollDeployment: async (deployment) => deployment,
      }),
    );
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 3);
  });

  it("deploys conservatively when the file list hits the GitHub cap", async () => {
    const posted = [];
    const created = [];
    const result = await runPreviewDeployComment(
      baseComment({
        listFiles: async () =>
          Array.from({ length: GITHUB_PR_FILES_LIMIT }, (_, index) => ({
            filename: `docs/page-${index}.md`,
          })),
        prepareResources: async () => {},
        createDeployment: async (input) => {
          created.push(input);
          return { id: `dpl_${input.target.app}`, readyState: "READY" };
        },
        pollDeployment: async (deployment) => deployment,
        postComment: async (body) => {
          posted.push(body);
        },
      }),
    );
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 3);
    assert.deepEqual(posted, []);
  });

  it("comments when listing PR files fails", async () => {
    const posted = [];
    const reactions = [];
    await assert.rejects(
      () =>
        runPreviewDeployComment(
          baseComment({
            listFiles: async () => {
              throw new Error("rate limited");
            },
            postComment: async (body) => {
              posted.push(body);
            },
            addReaction: async (content) => {
              reactions.push(content);
            },
          }),
        ),
      /rate limited/,
    );
    assert.match(posted[0], /Preview deploy failed: rate limited/);
    assert.deepEqual(reactions, ["eyes"]);
  });
});

describe("git preview policy", () => {
  it("enables automatic git deployments for main only", async () => {
    for (const app of ["web", "core"]) {
      const config = JSON.parse(
        await readFile(path.join(repoRoot, "apps", app, "vercel.json"), "utf8"),
      );
      assert.deepEqual(config.git.deploymentEnabled, GIT_DEPLOYMENT_ENABLED);
    }
  });

  it("runs only manual deploys and serializes trusted cleanup with reset", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/preview-deploy.yml"),
      "utf8",
    );
    assert.match(workflow, /types: \[created\]/);
    assert.match(workflow, /workflows:\s*\["PR closed", "PR synchronize"\]/);
    assert.doesNotMatch(workflow, /types:.*opened/);
    assert.doesNotMatch(workflow, /^\s+pull_request_target:/m);
    assert.match(workflow, /schedule:/);
    for (const jobId of [
      "comment",
      "reset-db",
      "closed",
      "renew",
      "reconcile",
    ]) {
      const job = jobBlock(workflow, jobId);
      assert.match(
        checkoutStep(job, jobId),
        /ref:.*github\.event\.repository\.default_branch/,
      );
      assert.match(job, /persist-credentials: false/);
      assert.match(job, /environment: preview-database/);
      assert.match(job, /queue: max/);
      assert.match(job, /cancel-in-progress: false/);
      assert.match(job, /group:.*github\.workflow/);
      assert.match(job, /secrets\.NEON_API_KEY/);
      assert.doesNotMatch(job, /ref:.*pull_request\.head/);
    }
    const renew = jobBlock(workflow, "renew");
    assert.match(renew, /workflow_run\.name == 'PR synchronize'/);
    assert.match(renew, /preview-lifecycle\.ts renew/);
    assert.doesNotMatch(renew, /vercel-deploy\.mjs/);
    const closed = jobBlock(workflow, "closed");
    assert.match(closed, /workflow_run\.name == 'PR closed'/);
    assert.doesNotMatch(closed, /issues: write/);
    const reconcile = jobBlock(workflow, "reconcile");
    assert.match(reconcile, /group:.*matrix\.pr/);
    assert.match(jobBlock(workflow, "comment"), /!\(startsWith/);
  });

  it("does not deploy production from GitHub Actions", () => {
    assert.equal(
      existsSync(
        path.join(repoRoot, ".github/workflows/production-deploy.yml"),
      ),
      false,
    );
  });
});
