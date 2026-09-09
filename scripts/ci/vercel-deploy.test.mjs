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
  PREVIEW_RELEVANT_PREFIXES,
  parseDeployComment,
  pickPreviewUrl,
  pollDeploymentUntilSettled,
  runPreviewDeployComment,
  runPreviewDeployOpened,
  runPreviewFromGithubEvent,
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

  it("returns usage for /deploy with no networks", () => {
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
      /Usage: `\/deploy <mainnet\|preprod> \[mainnet\|preprod\]` or `\/deploy all`/,
    );
    assert.doesNotMatch(message, /<mainnet\|preprod\|all>/);
    assert.match(message, /\/deploy mainnet/);
    assert.match(message, /\/deploy preprod/);
    assert.match(message, /\/deploy mainnet preprod/);
    assert.match(message, /\/deploy all/);
    assert.doesNotMatch(message, /@vercel/);
  });
});

describe("deployTargets", () => {
  it("always deploys web and core together per network", () => {
    const mainnet = deployTargets(["mainnet"]);
    assert.deepEqual(
      mainnet.map((target) => `${target.network}:${target.app}`),
      ["mainnet:web", "mainnet:core"],
    );
    assert.equal(mainnet[0].projectId, VERCEL_PROJECTS.mainnet.web.id);
    assert.equal(mainnet[1].projectId, VERCEL_PROJECTS.mainnet.core.id);

    const both = deployTargets(["mainnet", "preprod"]);
    assert.equal(both.length, 4);
    assert.equal(both[2].projectId, VERCEL_PROJECTS.preprod.web.id);
    assert.equal(both[3].projectId, VERCEL_PROJECTS.preprod.core.id);
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
});

describe("pickPreviewUrl", () => {
  it("prefers the git preview.sokosumi.com alias", () => {
    assert.equal(
      pickPreviewUrl({
        url: "sokosumi-app-mainnet-abc.vercel.app",
        alias: [
          "sokosumi-app-mainnet-abc.vercel.app",
          "sokosumi-app-mainnet-git-feat-preview.preview.sokosumi.com",
        ],
      }),
      "https://sokosumi-app-mainnet-git-feat-preview.preview.sokosumi.com",
    );
  });

  it("falls back to the deployment url", () => {
    assert.equal(
      pickPreviewUrl({ url: "sokosumi-app-mainnet-abc.vercel.app" }),
      "https://sokosumi-app-mainnet-abc.vercel.app",
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

  it("replies with usage for a bare /deploy", async () => {
    const posted = [];
    const result = await runPreviewDeployComment({
      commentBody: "/deploy",
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

  it("creates web and core previews for the named network", async () => {
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
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99, fork: false } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "apps/web/app/page.tsx" }],
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
    assert.equal(created.length, 2);
    assert.deepEqual(
      created.map((item) => item.target.app),
      ["web", "core"],
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
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99, fork: false } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "packages/utils/src/index.ts" }],
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
            head: { sha: "abc", ref: "feat", repo: { id: 99 } },
            base: { repo: { id: 99 } },
          }),
          listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
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
            head: { sha: "abc", ref: "feat", repo: { id: 99 } },
            base: { repo: { id: 99 } },
          }),
          listFiles: async () => ["apps/web/app/page.tsx"],
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

describe("runPreviewDeployOpened", () => {
  function sameRepoPullRequest(overrides = {}) {
    return {
      user: { type: "User", login: "alice" },
      head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99, fork: false } },
      base: { repo: { id: 99 } },
      ...overrides,
    };
  }

  it("deploys web and core on both networks at the PR HEAD", async () => {
    const urls = [];
    const created = [];
    const result = await runPreviewDeployOpened({
      pullRequest: sameRepoPullRequest(),
      repoId: 99,
      createDeployment: async (input) => {
        created.push(input);
        return {
          id: `dpl_${input.target.name}`,
          readyState: "READY",
        };
      },
      pollDeployment: async (deployment) => deployment,
      fetchImpl: async (url) => {
        urls.push(String(url));
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 4);
    assert.deepEqual(
      created.map((item) => `${item.target.network}:${item.target.app}`),
      ["mainnet:web", "mainnet:core", "preprod:web", "preprod:core"],
    );
    assert.ok(created.every((item) => item.sha === "deadbeef"));
    assert.ok(created.every((item) => item.ref === "feat/x"));
    assert.ok(created.every((item) => item.repoId === 99));
    assert.ok(created.every((item) => item.deploymentTarget === undefined));
    assert.deepEqual(urls, []);
  });

  it("deploys draft pull requests", async () => {
    const created = [];
    const result = await runPreviewDeployOpened({
      pullRequest: sameRepoPullRequest({ draft: true }),
      repoId: 99,
      createDeployment: async (input) => {
        created.push(input);
        return { id: `dpl_${input.target.name}`, readyState: "READY" };
      },
      pollDeployment: async (deployment) => deployment,
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 4);
  });

  it("ignores pull requests opened by bots", async () => {
    const created = [];
    const result = await runPreviewDeployOpened({
      pullRequest: sameRepoPullRequest({
        user: { type: "Bot", login: "cursor[bot]" },
      }),
      repoId: 99,
      createDeployment: async (input) => {
        created.push(input);
        return { id: "dpl", readyState: "READY" };
      },
      pollDeployment: async (deployment) => deployment,
    });
    assert.equal(result.kind, "ignore");
    assert.deepEqual(created, []);
  });

  it("refuses fork pull requests without commenting", async () => {
    const urls = [];
    const created = [];
    const result = await runPreviewDeployOpened({
      pullRequest: {
        user: { type: "User", login: "alice" },
        head: { sha: "abc", ref: "feat", repo: { id: 2, fork: true } },
        base: { repo: { id: 1 } },
      },
      createDeployment: async (input) => {
        created.push(input);
        return { id: "dpl", readyState: "READY" };
      },
      fetchImpl: async (url) => {
        urls.push(String(url));
        throw new Error(`unexpected fetch ${url}`);
      },
    });
    assert.equal(result.kind, "fork");
    assert.deepEqual(created, []);
    assert.deepEqual(urls, []);
  });

  it("throws when a preview deployment is not READY and does not comment", async () => {
    const urls = [];
    await assert.rejects(
      () =>
        runPreviewDeployOpened({
          pullRequest: sameRepoPullRequest(),
          repoId: 99,
          createDeployment: async (input) => ({
            id: `dpl_${input.target.name}`,
            readyState: input.target.app === "core" ? "ERROR" : "READY",
          }),
          pollDeployment: async (deployment) => deployment,
          fetchImpl: async (url) => {
            urls.push(String(url));
            throw new Error(`unexpected fetch ${url}`);
          },
        }),
      /sokosumi-core-mainnet \(ERROR\)/,
    );
    assert.deepEqual(urls, []);
  });
});

describe("runPreviewFromGithubEvent", () => {
  it("routes pull_request opened events to the opened deploy", async () => {
    const created = [];
    const result = await runPreviewFromGithubEvent({
      eventName: "pull_request",
      event: {
        action: "opened",
        pull_request: {
          user: { type: "User", login: "alice" },
          head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99 } },
          base: { repo: { id: 99 } },
        },
        repository: { id: 99 },
      },
      createDeployment: async (input) => {
        created.push(input);
        return { id: `dpl_${input.target.name}`, readyState: "READY" };
      },
      pollDeployment: async (deployment) => deployment,
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 4);
  });

  it("ignores pull_request events that are not opened", async () => {
    const created = [];
    for (const action of ["synchronize", "ready_for_review", "reopened"]) {
      const result = await runPreviewFromGithubEvent({
        eventName: "pull_request",
        event: {
          action,
          pull_request: {
            user: { type: "User", login: "alice" },
            head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99 } },
            base: { repo: { id: 99 } },
          },
          repository: { id: 99 },
        },
        createDeployment: async (input) => {
          created.push(input);
          return { id: "dpl", readyState: "READY" };
        },
      });
      assert.equal(result.kind, "ignore", action);
    }
    assert.deepEqual(created, []);
  });

  it("routes issue_comment events to the comment deploy", async () => {
    const created = [];
    const result = await runPreviewFromGithubEvent({
      eventName: "issue_comment",
      event: {
        comment: { body: "/deploy mainnet", user: { login: "alice" }, id: 1 },
        issue: { pull_request: {}, number: 12 },
        repository: { id: 99 },
      },
      isPullRequest: true,
      commentAuthor: "alice",
      readPermission: async () => "write",
      readPullRequest: async () => ({
        head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99 } },
        base: { repo: { id: 99 } },
      }),
      listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
      createDeployment: async (input) => {
        created.push(input);
        return { id: `dpl_${input.target.app}`, readyState: "READY" };
      },
      pollDeployment: async (deployment) => deployment,
      postComment: async () => {},
      addReaction: async () => {},
    });
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 2);
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
  it("matches web, core, and workspace package paths", () => {
    assert.equal(isPreviewRelevantPath("apps/web/app/page.tsx"), true);
    assert.equal(isPreviewRelevantPath("apps/core/src/index.ts"), true);
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

  it("keeps the pull_request paths filter in sync with the prefixes", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/preview-deploy.yml"),
      "utf8",
    );
    const triggerSection = workflow.split(/^jobs:/m)[0];
    assert.match(triggerSection, /pull_request:\s*\n/);
    assert.match(triggerSection, /paths:\s*\n/);
    for (const prefix of PREVIEW_RELEVANT_PREFIXES) {
      assert.ok(
        triggerSection.includes(`- "${prefix}**"`),
        `workflow paths filter is missing ${prefix}**`,
      );
    }
    const commentSection = triggerSection.split(/pull_request:/)[0];
    assert.match(commentSection, /issue_comment:/);
    assert.doesNotMatch(commentSection, /paths:/);
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
        createDeployment: async (input) => {
          created.push(input);
          return { id: `dpl_${input.target.app}`, readyState: "READY" };
        },
        pollDeployment: async (deployment) => deployment,
      }),
    );
    assert.equal(result.kind, "deploy");
    assert.equal(created.length, 2);
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
    assert.equal(created.length, 2);
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

  it("runs comment-gated deploys and one opened-PR deploy from Actions", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/preview-deploy.yml"),
      "utf8",
    );
    assert.match(workflow, /issue_comment:/);
    assert.match(workflow, /types:\s*\[created\]/);
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /types:\s*\[opened\]/);
    assert.doesNotMatch(workflow, /ready_for_review/);
    assert.doesNotMatch(workflow, /synchronize/);
    assert.match(workflow, /github\.event_name == 'issue_comment'/);
    assert.match(workflow, /github\.event_name == 'pull_request'/);
    assert.match(
      workflow,
      /github\.event\.pull_request\.user\.type\s*!=\s*'Bot'/,
    );
    assert.match(
      workflow,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    );
    assert.match(workflow, /node scripts\/ci\/vercel-deploy\.mjs preview/);
    assert.match(workflow, /persist-credentials:\s*false/);
    assert.match(
      workflow,
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/,
    );
    assert.match(workflow, /secrets\.VERCEL_TOKEN/);
    assert.match(workflow, /vars\.VERCEL_TEAM_ID/);
    assert.match(workflow, /secrets\.GITHUB_TOKEN/);
    assert.match(workflow, /issues:\s*write/);
    assert.match(workflow, /pull-requests:\s*write/);
    const openedJob = workflow.split(/opened:\s*\n/)[1];
    assert.ok(openedJob);
    assert.doesNotMatch(openedJob, /GITHUB_TOKEN/);
    assert.doesNotMatch(openedJob, /issues:\s*write/);
    assert.doesNotMatch(openedJob, /pull-requests:\s*write/);
    assert.doesNotMatch(
      openedJob,
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha/,
    );
    assert.match(
      workflow,
      /contains\(github\.event\.comment\.body, '\/deploy'\)/,
    );
    assert.doesNotMatch(workflow, /lower\(/);
    assert.match(workflow, /github\.event\.comment\.user\.type\s*!=\s*'Bot'/);
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
