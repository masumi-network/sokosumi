#!/usr/bin/env node
/**
 * Create Vercel git deployments from GitHub Actions.
 *
 *   node scripts/ci/vercel-deploy.mjs preview     # `/deploy` PR comment
 *   node scripts/ci/vercel-deploy.mjs production  # push to main
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NETWORKS = ["mainnet", "preprod"];
const APPS = ["web", "core"];
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

export const VERCEL_TEAM_ID = "team_vDNcRyOgTGZegIQbMw4QXF0n";

export const VERCEL_PROJECTS = {
  mainnet: {
    web: {
      id: "prj_q93ayf8IpLM1QNdnlBZw02jMoTyC",
      name: "sokosumi-app-mainnet",
    },
    core: {
      id: "prj_GrqmJbIxWe0I6aYiZHZC2hiJYLiH",
      name: "sokosumi-core-mainnet",
    },
  },
  preprod: {
    web: {
      id: "prj_DsK6SqWjSU47g7O3unja5h4jtxMk",
      name: "sokosumi-app-preprod",
    },
    core: {
      id: "prj_CSgdc8zCRyR5ZT1LH8VkDJBJTtff",
      name: "sokosumi-core-preprod",
    },
  },
};

export function parseDeployComment(body) {
  const firstLine = String(body ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/, 1)[0]
    .trim();
  const tokens = firstLine.split(/\s+/).filter(Boolean);
  if ((tokens[0] ?? "").toLowerCase() !== "/deploy") {
    return { kind: "ignore" };
  }

  const rest = tokens.slice(1).map((token) => token.toLowerCase());
  if (rest.length === 0) {
    return { kind: "usage" };
  }

  const unique = [...new Set(rest)];
  if (unique.some((token) => !NETWORKS.includes(token))) {
    return { kind: "usage" };
  }

  return {
    kind: "deploy",
    networks: NETWORKS.filter((network) => unique.includes(network)),
  };
}

export function isWritePermission(permission) {
  return WRITE_PERMISSIONS.has(permission);
}

export function usageMessage() {
  return [
    "Usage: `/deploy <mainnet|preprod> [mainnet|preprod]`",
    "",
    "`/deploy mainnet`",
    "`/deploy preprod`",
    "`/deploy mainnet preprod`",
    "",
    "Deploys web + core for the named network(s) at this PR's current HEAD. Later pushes stay undeployed until you comment again.",
  ].join("\n");
}

export function deployTargets(networks) {
  const targets = [];
  for (const network of NETWORKS) {
    if (!networks.includes(network)) {
      continue;
    }
    for (const app of APPS) {
      const project = VERCEL_PROJECTS[network][app];
      targets.push({
        network,
        app,
        projectId: project.id,
        name: project.name,
      });
    }
  }
  return targets;
}

function asHttpsUrl(host) {
  if (!host) {
    return undefined;
  }
  return host.startsWith("https://") || host.startsWith("http://")
    ? host
    : `https://${host}`;
}

export function pickPreviewUrl(deployment) {
  const aliases = deployment.alias ?? [];
  const gitPreview = aliases.find(
    (alias) =>
      alias.includes("-git-") && alias.endsWith(".preview.sokosumi.com"),
  );
  const previewSuffix = aliases.find((alias) =>
    alias.endsWith(".preview.sokosumi.com"),
  );
  return asHttpsUrl(gitPreview ?? previewSuffix ?? deployment.url);
}

export async function createGitDeployment({
  token,
  teamId,
  target,
  repoId,
  ref,
  sha,
  deploymentTarget,
  fetchImpl = globalThis.fetch,
}) {
  const url = new URL("https://api.vercel.com/v13/deployments");
  url.searchParams.set("forceNew", "1");
  url.searchParams.set("skipAutoDetectionConfirmation", "1");
  url.searchParams.set("teamId", teamId);

  const body = {
    name: target.name,
    project: target.projectId,
    gitSource: {
      type: "github",
      repoId,
      ref,
      sha,
    },
  };
  if (deploymentTarget) {
    body.target = deploymentTarget;
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Vercel deploy failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

const TERMINAL_READY_STATES = new Set([
  "READY",
  "ERROR",
  "CANCELED",
  "BLOCKED",
]);

export async function pollDeploymentUntilSettled({
  deployment,
  token,
  teamId,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 15 * 60 * 1000,
  intervalMs = 5000,
}) {
  if (TERMINAL_READY_STATES.has(deployment.readyState)) {
    return deployment;
  }

  const deadline = Date.now() + timeoutMs;
  let current = deployment;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    if (!current.id) {
      throw new Error("Vercel deployment poll lost deployment id");
    }
    const url = new URL(`https://api.vercel.com/v13/deployments/${current.id}`);
    url.searchParams.set("teamId", teamId);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      continue;
    }
    const payload = await response.json();
    if (!payload?.id) {
      continue;
    }
    current = payload;
    if (TERMINAL_READY_STATES.has(current.readyState)) {
      return current;
    }
  }
  throw new Error(
    `Vercel deployment ${current.id} did not finish (last state: ${current.readyState ?? "UNKNOWN"})`,
  );
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sokosumi-vercel-deploy",
  };
}

async function githubJson(fetchImpl, token, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...init.headers,
    },
  });
  if (response.status === 404) {
    return null;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function formatDeployComment(networks, sha, targets, deployments) {
  const shortSha = sha.slice(0, 7);
  const lines = [
    `Preview deploy for **${networks.join(" + ")}** at \`${shortSha}\`:`,
    "",
  ];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const deployment = deployments[index];
    const state = deployment.readyState ?? "UNKNOWN";
    const url =
      state === "READY"
        ? pickPreviewUrl(deployment)
        : (deployment.inspectorUrl ?? pickPreviewUrl(deployment));
    lines.push(`- ${target.name} (${state}): ${url ?? "no URL yet"}`);
  }
  return lines.join("\n");
}

export async function runPreviewDeployComment(options) {
  const {
    commentBody,
    isPullRequest,
    commentAuthor,
    repoOwner,
    repoName,
    repoId,
    issueNumber,
    vercelToken,
    teamId = VERCEL_TEAM_ID,
    githubToken,
    fetchImpl = globalThis.fetch,
    readPermission,
    readPullRequest,
    createDeployment,
    pollDeployment,
    postComment,
  } = options;

  if (!isPullRequest) {
    return { kind: "ignore" };
  }

  const parsed = parseDeployComment(commentBody);
  if (parsed.kind === "ignore") {
    return parsed;
  }

  const comment =
    postComment ??
    (async (body) => {
      await githubJson(
        fetchImpl,
        githubToken,
        `https://api.github.com/repos/${repoOwner}/${repoName}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
    });

  const permission = await (readPermission
    ? readPermission()
    : githubJson(
        fetchImpl,
        githubToken,
        `https://api.github.com/repos/${repoOwner}/${repoName}/collaborators/${commentAuthor}/permission`,
      ).then((payload) => payload?.permission ?? "none"));

  if (!isWritePermission(permission)) {
    await comment(
      "Only people with write access to this repository can trigger preview deployments.",
    );
    return { kind: "denied" };
  }

  if (parsed.kind === "usage") {
    await comment(usageMessage());
    return parsed;
  }

  const pullRequest = await (readPullRequest
    ? readPullRequest()
    : githubJson(
        fetchImpl,
        githubToken,
        `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${issueNumber}`,
      ));

  if (!pullRequest) {
    throw new Error(`Pull request ${issueNumber} was not found`);
  }

  if (pullRequest.head.repo.id !== pullRequest.base.repo.id) {
    await comment(
      "Preview deploy is only available for branches in this repository, not forks.",
    );
    return { kind: "fork" };
  }

  const create =
    createDeployment ??
    ((input) =>
      createGitDeployment({
        token: vercelToken,
        teamId,
        fetchImpl,
        ...input,
      }));
  const poll =
    pollDeployment ??
    ((deployment) =>
      pollDeploymentUntilSettled({
        deployment,
        token: vercelToken,
        teamId,
        fetchImpl,
      }));

  const targets = deployTargets(parsed.networks);
  const git = {
    repoId: repoId ?? pullRequest.base.repo.id,
    ref: pullRequest.head.ref,
    sha: pullRequest.head.sha,
  };
  try {
    const created = await Promise.all(
      targets.map((target) => create({ target, ...git })),
    );
    const settled = await Promise.all(
      created.map((deployment) => poll(deployment)),
    );
    await comment(
      formatDeployComment(parsed.networks, git.sha, targets, settled),
    );
    return { kind: "deploy", deployments: settled };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await comment(`Preview deploy failed: ${message}`);
    throw error;
  }
}

export async function runProductionDeploy(options) {
  const {
    repoId,
    ref,
    sha,
    vercelToken,
    teamId = VERCEL_TEAM_ID,
    fetchImpl = globalThis.fetch,
    createDeployment,
    pollDeployment,
  } = options;

  const create =
    createDeployment ??
    ((input) =>
      createGitDeployment({
        token: vercelToken,
        teamId,
        fetchImpl,
        ...input,
      }));
  const poll =
    pollDeployment ??
    ((deployment) =>
      pollDeploymentUntilSettled({
        deployment,
        token: vercelToken,
        teamId,
        fetchImpl,
      }));

  const targets = deployTargets(["mainnet", "preprod"]);
  const created = await Promise.all(
    targets.map((target) =>
      create({
        target,
        repoId,
        ref,
        sha,
        deploymentTarget: "production",
      }),
    ),
  );
  const settled = await Promise.all(
    created.map((deployment) => poll(deployment)),
  );
  const failed = targets.flatMap((target, index) => {
    const state = settled[index]?.readyState;
    if (state === "READY") {
      return [];
    }
    return [`${target.name} (${state ?? "UNKNOWN"})`];
  });
  if (failed.length > 0) {
    throw new Error(`Production deploy failed: ${failed.join(", ")}`);
  }
  return { kind: "production", deployments: settled };
}

function requireVercelToken(env) {
  if (!env.VERCEL_TOKEN) {
    throw new Error("VERCEL_TOKEN is required");
  }
}

function readGithubEvent(env) {
  if (!env.GITHUB_EVENT_PATH) {
    throw new Error("GitHub Actions event context is required");
  }
  return readFile(env.GITHUB_EVENT_PATH, "utf8").then((text) =>
    JSON.parse(text),
  );
}

async function cliPreview(env = process.env) {
  requireVercelToken(env);
  if (!env.GITHUB_REPOSITORY) {
    throw new Error("GitHub Actions event context is required");
  }
  const event = await readGithubEvent(env);
  const [repoOwner, repoName] = env.GITHUB_REPOSITORY.split("/");
  const result = await runPreviewDeployComment({
    commentBody: event.comment.body,
    commentAuthor: event.comment.user.login,
    isPullRequest: Boolean(event.issue.pull_request),
    issueNumber: event.issue.number,
    repoOwner,
    repoName,
    repoId: event.repository.id,
    vercelToken: env.VERCEL_TOKEN,
    githubToken: env.GITHUB_TOKEN,
    teamId: env.VERCEL_ORG_ID ?? VERCEL_TEAM_ID,
  });
  console.log(JSON.stringify(result));
}

async function cliProduction(env = process.env) {
  requireVercelToken(env);
  const event = await readGithubEvent(env);
  const ref = String(event.ref ?? env.GITHUB_REF ?? "main").replace(
    /^refs\/heads\//,
    "",
  );
  const result = await runProductionDeploy({
    repoId: event.repository.id,
    ref,
    sha: event.after ?? env.GITHUB_SHA,
    vercelToken: env.VERCEL_TOKEN,
    teamId: env.VERCEL_ORG_ID ?? VERCEL_TEAM_ID,
  });
  console.log(JSON.stringify(result));
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const command = process.argv[2];
  if (command === "preview") {
    await cliPreview();
  } else if (command === "production") {
    await cliProduction();
  } else {
    console.error(
      "Usage: node scripts/ci/vercel-deploy.mjs <preview|production>",
    );
    process.exit(1);
  }
}
