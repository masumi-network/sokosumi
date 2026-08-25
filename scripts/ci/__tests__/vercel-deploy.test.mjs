import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createGitDeployment,
  deployTargets,
  isWritePermission,
  parseDeployComment,
  pickPreviewUrl,
  pollDeploymentUntilSettled,
  runPreviewDeployComment,
  runProductionDeploy,
  usageMessage,
  VERCEL_PROJECTS,
  VERCEL_TEAM_ID,
} from "../vercel-deploy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

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

  it("sets target production when requested", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ id: "dpl_prod", readyState: "QUEUED" }),
      };
    };

    await createGitDeployment({
      token: "tok",
      teamId: VERCEL_TEAM_ID,
      target: deployTargets(["mainnet"])[0],
      repoId: 123,
      ref: "main",
      sha: "abc123",
      deploymentTarget: "production",
      fetchImpl,
    });

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.target, "production");
    assert.equal(body.gitSource.ref, "main");
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
    assert.deepEqual(reactions, ["rocket"]);
  });

  it("reacts rocket on the triggering comment via the GitHub API", async () => {
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
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(
      calls[0].url,
      "https://api.github.com/repos/acme/sokosumi/issues/comments/4242/reactions",
    );
    assert.deepEqual(JSON.parse(calls[0].body), { content: "rocket" });
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
    assert.deepEqual(reactions, []);
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
    assert.deepEqual(reactions, []);
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

describe("runProductionDeploy", () => {
  it("deploys web and core on both networks as production", async () => {
    const created = [];
    const result = await runProductionDeploy({
      repoId: 99,
      ref: "main",
      sha: "cafed00d",
      createDeployment: async (input) => {
        created.push(input);
        return {
          id: `dpl_${input.target.name}`,
          url: `${input.target.name}.vercel.app`,
          readyState: "READY",
        };
      },
      pollDeployment: async (deployment) => deployment,
    });

    assert.equal(result.kind, "production");
    assert.equal(created.length, 4);
    assert.deepEqual(
      created.map((item) => item.target.name),
      [
        "sokosumi-app-mainnet",
        "sokosumi-core-mainnet",
        "sokosumi-app-preprod",
        "sokosumi-core-preprod",
      ],
    );
    assert.ok(created.every((item) => item.deploymentTarget === "production"));
    assert.ok(created.every((item) => item.ref === "main"));
    assert.ok(created.every((item) => item.sha === "cafed00d"));
  });

  it("fails the run when a production deployment is not READY", async () => {
    await assert.rejects(
      () =>
        runProductionDeploy({
          repoId: 99,
          ref: "main",
          sha: "bad",
          createDeployment: async (input) => ({
            id: `dpl_${input.target.name}`,
            name: input.target.name,
            readyState: input.target.app === "core" ? "ERROR" : "READY",
          }),
          pollDeployment: async (deployment) => deployment,
        }),
      /sokosumi-core-mainnet \(ERROR\)/,
    );
  });
});

describe("git preview policy", () => {
  it("disables all automatic git deployments", async () => {
    for (const app of ["web", "core"]) {
      const config = JSON.parse(
        await readFile(path.join(repoRoot, "apps", app, "vercel.json"), "utf8"),
      );
      assert.equal(config.git.deploymentEnabled, false);
    }
  });

  it("runs comment-gated deploys from the default branch", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/preview-deploy.yml"),
      "utf8",
    );
    assert.match(workflow, /issue_comment:/);
    assert.match(workflow, /types:\s*\[created\]/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.match(workflow, /node scripts\/ci\/vercel-deploy\.mjs preview/);
    assert.match(workflow, /persist-credentials:\s*false/);
    assert.match(workflow, /secrets\.VERCEL_TOKEN/);
    assert.match(workflow, /vars\.VERCEL_TEAM_ID/);
    assert.match(workflow, /secrets\.GITHUB_TOKEN/);
    assert.match(workflow, /issues:\s*write/);
    assert.match(
      workflow,
      /contains\(github\.event\.comment\.body, '\/deploy'\)/,
    );
    assert.doesNotMatch(workflow, /lower\(/);
    assert.match(workflow, /github\.event\.comment\.user\.type\s*!=\s*'Bot'/);
  });

  it("deploys production from GitHub Actions on push to main", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/production-deploy.yml"),
      "utf8",
    );
    assert.match(workflow, /push:/);
    assert.match(workflow, /branches:\s*\[main\]/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.match(workflow, /node scripts\/ci\/vercel-deploy\.mjs production/);
    assert.match(workflow, /persist-credentials:\s*false/);
    assert.match(workflow, /secrets\.VERCEL_TOKEN/);
    assert.match(workflow, /vars\.VERCEL_TEAM_ID/);
    assert.match(workflow, /cancel-in-progress:\s*false/);
  });
});
