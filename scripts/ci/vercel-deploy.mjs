#!/usr/bin/env node
/**
 * Create Vercel git deployments from GitHub Actions.
 *
 *   node scripts/ci/vercel-deploy.mjs preview     # `/deploy` comment on an open PR
 *
 * Production deploys from Vercel Git on `main` (see apps/web and apps/core vercel.json).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  preparePreviewResources,
  previewMetadata,
  vercelErrorDetail,
} from "./preview-resources.ts";

const NETWORKS = ["mainnet", "preprod"];
const APPS = ["web", "core", "cmo"];
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
    // CMO has no preprod project; it signs in against mainnet Core only.
    cmo: {
      id: "prj_xtwf8SX1HCG9xfjBiNZ3JmOTlqsN",
      name: "sokosumi-cmo",
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

// Full SHA only: a short prefix can be brute-forced by a fork pushing a
// colliding commit between the approval and the deploy.
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Parse `<command> <mainnet|preprod> [mainnet|preprod] [sha]` or
 * `<command> all [sha]` from the first line of a PR comment. `sha` is the
 * full head commit the commenter approves, or null.
 */
export function parseNetworkCommand(body, command) {
  const firstLine = String(body ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/, 1)[0]
    .trim();
  const tokens = firstLine.split(/\s+/).filter(Boolean);
  if ((tokens[0] ?? "").toLowerCase() !== command) {
    return { kind: "ignore" };
  }

  const rest = tokens.slice(1).map((token) => token.toLowerCase());
  const shas = [...new Set(rest.filter((token) => FULL_SHA.test(token)))];
  const unique = [...new Set(rest.filter((token) => !FULL_SHA.test(token)))];
  if (unique.length === 0 || shas.length > 1) {
    return { kind: "usage" };
  }
  const sha = shas[0] ?? null;

  if (unique.length === 1 && unique[0] === "all") {
    return { kind: "run", networks: [...NETWORKS], sha };
  }

  if (unique.some((token) => !NETWORKS.includes(token))) {
    return { kind: "usage" };
  }

  return {
    kind: "run",
    networks: NETWORKS.filter((network) => unique.includes(network)),
    sha,
  };
}

export function parseDeployComment(body) {
  const parsed = parseNetworkCommand(body, "/deploy");
  return parsed.kind === "run"
    ? { kind: "deploy", networks: parsed.networks, sha: parsed.sha }
    : parsed;
}

export function isWritePermission(permission) {
  return WRITE_PERMISSIONS.has(permission);
}

export function usageMessage() {
  return [
    "Usage: `/deploy <mainnet|preprod> [mainnet|preprod]` or `/deploy all`",
    "",
    "`/deploy mainnet`",
    "`/deploy preprod`",
    "`/deploy mainnet preprod`",
    "`/deploy all`",
    "",
    "Deploys web + core for the named network(s), plus CMO on mainnet, at this PR's current HEAD. Later pushes stay undeployed until you comment again.",
    "",
    "On a pull request from a fork, add the full 40-character head commit SHA you reviewed (for example `/deploy preprod <sha>`). The preview builds that commit with preview secrets, so review the whole diff at that commit first. Commits pushed later never deploy on their own.",
    "",
    "Add `--reset-db` on the first line (for example `/deploy preprod --reset-db`) to first reset this PR's Neon preview database to its parent. The Core build then applies every migration the parent lacks, this PR's included.",
  ].join("\n");
}

export function deployTargets(networks, apps = APPS) {
  const targets = [];
  for (const network of NETWORKS) {
    if (!networks.includes(network)) {
      continue;
    }
    for (const app of apps) {
      const project = VERCEL_PROJECTS[network][app];
      if (!project) {
        continue;
      }
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

/**
 * Repo paths that can change a preview build: the Vercel apps plus every
 * workspace package (the transitive dependency closure of web and core —
 * currently all of `packages/`). The `/deploy` comment flow checks
 * these prefixes via the PR files API. PR-close cleanup has no path filter.
 */
export const PREVIEW_RELEVANT_PREFIXES = [
  "apps/web/",
  "apps/core/",
  "apps/cmo/",
  "packages/",
];

export function isPreviewRelevantPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return false;
  }
  const normalized = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  return PREVIEW_RELEVANT_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function hasPreviewRelevantChanges(files) {
  if (!Array.isArray(files)) {
    return false;
  }
  return files.some((file) =>
    isPreviewRelevantPath(typeof file === "string" ? file : file?.filename),
  );
}

const VERCEL_CONFIG_FILE = /(^|\/)(vercel\.(json|[cm]?[jt]s)|now\.json)$/;

/**
 * Whether any changed file is a Vercel project config Vercel reads from Git.
 * Renaming one away counts: without it, Vercel builds every branch.
 */
export function changesVercelConfig(files) {
  return files.some((file) =>
    (typeof file === "string"
      ? [file]
      : [file?.filename, file?.previous_filename]
    ).some((name) => typeof name === "string" && VERCEL_CONFIG_FILE.test(name)),
  );
}

export function noPreviewChangesMessage() {
  return [
    "No preview deployment: this pull request has no changes under `apps/web/`, `apps/core/`, `apps/cmo/`, or `packages/`.",
    "",
    "Previews only build web, core, CMO, and their package dependencies. If you still need a preview, push a change under one of those paths and comment `/deploy <network>` again.",
  ].join("\n");
}

export async function createGitDeployment({
  token,
  teamId,
  target,
  repoId,
  ref,
  sha,
  meta,
  fetchImpl = globalThis.fetch,
}) {
  const url = new URL("https://api.vercel.com/v13/deployments");
  url.searchParams.set("forceNew", "1");
  url.searchParams.set("skipAutoDetectionConfirmation", "1");
  url.searchParams.set("teamId", teamId);

  const body = {
    name: target.name,
    project: target.projectId,
    ...(meta ? { meta } : {}),
    gitSource: {
      type: "github",
      repoId,
      ref,
      sha,
    },
  };

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      ...vercelAuthHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    // Vercel's error body names the cause; without it the log shows only a status.
    throw new Error(
      `Vercel deploy failed for ${target.name} (${response.status})${vercelErrorDetail(payload)}`,
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
      headers: vercelAuthHeaders(token),
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

export function vercelAuthHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sokosumi-vercel-deploy",
  };
}

export async function githubJson(fetchImpl, token, url, init = {}) {
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
    throw githubError(response.status, payload);
  }
  return payload;
}

export function githubError(status, payload) {
  return new Error(`GitHub ${status}: ${JSON.stringify(payload)}`);
}

/**
 * GitHub's list-pull-request-files endpoint returns at most this many files.
 * A list that reaches the cap may be truncated, so callers must not treat it
 * as a complete absence of relevant changes (see isTruncatedFileList).
 */
export const GITHUB_PR_FILES_LIMIT = 3000;

export function isTruncatedFileList(files) {
  return Array.isArray(files) && files.length >= GITHUB_PR_FILES_LIMIT;
}

export async function listPullRequestFiles({
  fetchImpl = globalThis.fetch,
  githubToken,
  repoOwner,
  repoName,
  pullNumber,
  perPage = 100,
}) {
  const files = [];
  let page = 1;
  for (;;) {
    const url = new URL(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${pullNumber}/files`,
    );
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    const payload = await githubJson(fetchImpl, githubToken, String(url));
    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }
    files.push(...payload);
    if (payload.length < perPage || isTruncatedFileList(files)) {
      break;
    }
    page += 1;
  }
  return files;
}

function failedDeployments(targets, deployments) {
  return targets.flatMap((target, index) => {
    const state = deployments[index]?.readyState;
    if (state === "READY") {
      return [];
    }
    return [{ target, state: state ?? "UNKNOWN" }];
  });
}

/**
 * The branch a preview deploys from and scopes its Core env vars to. A fork's
 * branch does not exist in this repository, and its name can equal one of
 * ours (even `main`). Vercel refused env vars scoped to `refs/pull/<n>/head`
 * with a 400, most likely because it scopes them only to branches of the
 * connected repository. So a fork deploys from a branch of ours that
 * `/deploy` points at the approved SHA (see pointForkPreviewBranch).
 */
export function previewRef(pullRequest) {
  return isSameRepoPullRequest(pullRequest)
    ? pullRequest.head.ref
    : forkPreviewBranch(pullRequest.number);
}

/** Reserved for the preview workflow: never push a branch under `preview-fork/`. */
export const FORK_PREVIEW_BRANCH_PREFIX = "preview-fork/pr-";

export function forkPreviewBranch(pullNumber) {
  return `${FORK_PREVIEW_BRANCH_PREFIX}${pullNumber}`;
}

/**
 * Create or force-move this repository's fork preview branch to `sha`, the
 * head commit the commenter approved. No workflow runs on that ref: GitHub
 * starts no run for a ref written with GITHUB_TOKEN. Vercel builds only
 * `main` on its own (`git.deploymentEnabled`); a fork that flips that only
 * builds this same approved commit.
 */
export async function pointForkPreviewBranch({
  fetchImpl = globalThis.fetch,
  githubToken,
  repoOwner,
  repoName,
  branch,
  sha,
}) {
  const refs = `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`;
  const headers = {
    ...githubHeaders(githubToken),
    "Content-Type": "application/json",
  };
  const created = await fetchImpl(refs, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (created.ok) {
    return;
  }
  // 422: the branch exists from an earlier `/deploy`. Move it, also after a
  // force-push to the fork.
  if (created.status !== 422) {
    throw githubError(
      created.status,
      await created.json().catch(() => undefined),
    );
  }
  const moved = await githubJson(
    fetchImpl,
    githubToken,
    `${refs}/heads/${branch}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha, force: true }),
    },
  );
  if (moved?.object?.sha !== sha) {
    throw new Error(`GitHub did not move ${branch} to the approved commit`);
  }
}

/** Delete the fork preview branch. A missing branch counts as deleted. */
export async function deleteForkPreviewBranch({
  fetchImpl = globalThis.fetch,
  githubToken,
  repoOwner,
  repoName,
  branch,
}) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`,
    { method: "DELETE", headers: githubHeaders(githubToken) },
  );
  // GitHub answers 422 "Reference does not exist" for a deleted branch.
  if (response.ok || response.status === 404 || response.status === 422) {
    return;
  }
  throw githubError(
    response.status,
    await response.json().catch(() => undefined),
  );
}

/** Opens the one bot comment that lists a fork PR's preview URLs. */
export const FORK_PREVIEW_COMMENT_MARKER = "<!-- sokosumi-fork-preview -->";
const ACTIONS_BOT_LOGIN = "github-actions[bot]";

/** The branch alias Vercel assigned the deployment, else its own URL. */
export function previewUrl(deployment) {
  const aliases = deployment.alias ?? [];
  const host =
    aliases.find((alias) => alias.includes("-git-")) ??
    aliases[0] ??
    deployment.url;
  return host ? `https://${host}` : null;
}

/**
 * The fork preview comment: one row per Vercel project, the newest deploy
 * replacing that project's row in `previous` (the comment's current body).
 */
export function forkPreviewCommentBody(deployments, sha, previous = "") {
  const rows = new Map();
  for (const line of previous.split("\n")) {
    const name = line.match(/^\| `([^`|]+)` \|/)?.[1];
    if (name) {
      rows.set(name, line);
    }
  }
  for (const deployment of deployments) {
    rows.set(
      deployment.name,
      `| \`${deployment.name}\` | ${previewUrl(deployment) ?? "none"} | ${deployment.readyState} | ${sha} |`,
    );
  }
  return [
    FORK_PREVIEW_COMMENT_MARKER,
    "**Fork preview**",
    "",
    "Vercel does not comment on pull requests from forks, so `/deploy` lists the previews here. Each row shows that project's latest deploy and the approved commit it built.",
    "",
    "| Project | Preview | State | Commit |",
    "| --- | --- | --- | --- |",
    ...[...rows.keys()].sort().map((name) => rows.get(name)),
  ].join("\n");
}

/**
 * Post the fork preview comment, or edit the one this workflow posted
 * earlier. Only a comment by the Actions bot counts: anyone can paste the
 * marker, and its rows would otherwise carry over.
 */
export async function upsertForkPreviewComment({
  fetchImpl = globalThis.fetch,
  githubToken,
  repoOwner,
  repoName,
  issueNumber,
  deployments,
  sha,
}) {
  const repo = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const perPage = 100;
  let existing;
  for (let page = 1; !existing; page += 1) {
    const payload = await githubJson(
      fetchImpl,
      githubToken,
      `${repo}/issues/${issueNumber}/comments?per_page=${perPage}&page=${page}`,
    );
    if (!Array.isArray(payload)) {
      break;
    }
    existing = payload.find(
      (comment) =>
        comment.user?.login === ACTIONS_BOT_LOGIN &&
        comment.body?.startsWith(FORK_PREVIEW_COMMENT_MARKER),
    );
    if (payload.length < perPage) {
      break;
    }
  }
  const body = forkPreviewCommentBody(deployments, sha, existing?.body);
  await githubJson(
    fetchImpl,
    githubToken,
    existing
      ? `${repo}/issues/comments/${existing.id}`
      : `${repo}/issues/${issueNumber}/comments`,
    {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

export function previewGitSource(pullRequest, repoId) {
  return {
    repoId: repoId ?? pullRequest.base.repo.id,
    ref: previewRef(pullRequest),
    sha: pullRequest.head.sha,
    meta: previewMetadata({
      repoId: repoId ?? pullRequest.base.repo.id,
      pullNumber: pullRequest.number,
    }),
  };
}

export function isSameRepoPullRequest(pullRequest) {
  return pullRequest.head.repo?.id === pullRequest.base.repo.id;
}

export async function settlePreviewDeployments(options) {
  const {
    networks,
    apps,
    git,
    vercelToken,
    teamId,
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

  const targets = deployTargets(networks, apps);
  // Wait for every deployment, also after one fails, so the job keeps the
  // per-PR queue while a Core build it started can still migrate.
  const created = await Promise.allSettled(
    targets.map((target) => create({ target, ...git })),
  );
  const polled = await Promise.allSettled(
    created.map((result) =>
      result.status === "fulfilled"
        ? poll(result.value)
        : Promise.reject(result.reason),
    ),
  );
  const rejected = polled.find((result) => result.status === "rejected");
  if (rejected) {
    throw rejected.reason;
  }
  const settled = polled.map((result) => result.value);
  const failed = failedDeployments(targets, settled);
  if (failed.length > 0) {
    throw Object.assign(
      new Error(
        failed
          .map(({ target, state }) => `${target.name} (${state})`)
          .join(", "),
      ),
      // Callers name the networks to deploy again, and whether Core failed.
      {
        networks: [...new Set(failed.map(({ target }) => target.network))],
        apps: [...new Set(failed.map(({ target }) => target.app))],
      },
    );
  }
  return { kind: "deploy", deployments: settled };
}

/**
 * Shared flow for PR comment commands: parse `command.name`, require write
 * access and a same-repository PR (or, with `command.allowFork`, a fork PR at
 * a named head SHA), react with eyes, then call `command.run`.
 * `run` reacts with rocket itself on success. A thrown error becomes a
 * `<subject> failed: …` reply.
 *
 * The fork PR's comment must name its full head SHA: the commenter approves
 * that reviewed commit, and a push after the review no longer matches.
 */
export async function runPullRequestCommand(options, command) {
  const {
    commentBody,
    isPullRequest,
    commentAuthor,
    commentId,
    repoOwner,
    repoName,
    issueNumber,
    githubToken,
    fetchImpl = globalThis.fetch,
    readPermission,
    readPullRequest,
    postComment,
    addReaction,
  } = options;

  if (!isPullRequest) {
    return { kind: "ignore" };
  }

  const parsed = parseNetworkCommand(commentBody, command.name);
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

  const react =
    addReaction ??
    (async (content) => {
      await githubJson(
        fetchImpl,
        githubToken,
        `https://api.github.com/repos/${repoOwner}/${repoName}/issues/comments/${commentId}/reactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
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
      `Only people with write access to this repository can ${command.action}.`,
    );
    return { kind: "denied" };
  }

  if (parsed.kind === "usage") {
    await comment(command.usage);
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

  const fork = !isSameRepoPullRequest(pullRequest);
  if (fork && !command.allowFork) {
    await comment(
      `${command.subject} is only available for branches in this repository, not forks.`,
    );
    return { kind: "fork" };
  }

  if (pullRequest.state !== "open") {
    await comment("Preview commands require an open pull request.");
    return { kind: "closed" };
  }

  // Neither reply names the head SHA: pasting it would approve commits
  // pushed after the commenter's review.
  if (fork && !parsed.sha) {
    await comment(
      `This pull request comes from a fork, and its preview builds with preview secrets. Review the code, then comment \`${command.name} ${parsed.networks.join(" ")} <sha>\` with the full 40-character SHA of the head commit you reviewed.`,
    );
    return { kind: "sha-required" };
  }

  // Also checked on same-repo PRs that name one: the SHA is an approval.
  if (parsed.sha && parsed.sha !== pullRequest.head.sha) {
    await comment(
      `\`${parsed.sha}\` is not this pull request's head commit. Review the commits pushed since, then comment again with the SHA of the head commit you reviewed.`,
    );
    return { kind: "sha-mismatch" };
  }

  try {
    await react("eyes");
    return await command.run({
      networks: parsed.networks,
      pullRequest,
      comment,
      react,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await comment(`${command.subject} failed: ${message}`);
    throw error;
  }
}

export async function runPreviewDeployComment(options) {
  const {
    repoOwner,
    repoName,
    repoId,
    issueNumber,
    vercelToken,
    teamId = VERCEL_TEAM_ID,
    githubToken,
    fetchImpl = globalThis.fetch,
    listFiles,
    createDeployment,
    pollDeployment,
  } = options;

  return runPullRequestCommand(options, {
    name: "/deploy",
    subject: "Preview deploy",
    action: "trigger preview deployments",
    usage: usageMessage(),
    allowFork: true,
    run: async ({ networks, pullRequest, comment, react }) => {
      const files = await (listFiles
        ? listFiles()
        : listPullRequestFiles({
            fetchImpl,
            githubToken,
            repoOwner,
            repoName,
            pullNumber: issueNumber,
          }));
      // A truncated list (GitHub caps PR files at GITHUB_PR_FILES_LIMIT) may hide
      // relevant changes further down, so only skip on a provably complete list.
      // Truncated lists fall through to a conservative deploy.
      if (!isTruncatedFileList(files) && !hasPreviewRelevantChanges(files)) {
        await comment(noPreviewChangesMessage());
        return { kind: "skip" };
      }
      const fork = !isSameRepoPullRequest(pullRequest);
      if (!fork && pullRequest.head.ref.startsWith("preview-fork/")) {
        await comment(
          "Branches under `preview-fork/` are reserved for fork previews. Push this change to another branch and open a new pull request to preview it.",
        );
        return { kind: "reserved-branch" };
      }
      // Vercel reads `git.deploymentEnabled` from the pushed commit, so a fork's
      // config could start builds on our branch in projects nobody approved.
      if (fork && (isTruncatedFileList(files) || changesVercelConfig(files))) {
        await comment(
          "This pull request comes from a fork and changes a Vercel config file such as `vercel.json`, or has too many changed files to check. A fork preview builds from a branch of this repository, where that file could start builds nobody approved, so it gets no preview.",
        );
        return { kind: "fork-vercel-config" };
      }
      // Before the env vars: Vercel refused them for a ref that is not a branch.
      if (fork) {
        await (options.pointBranch ?? pointForkPreviewBranch)({
          fetchImpl,
          githubToken,
          repoOwner,
          repoName,
          branch: previewRef(pullRequest),
          sha: pullRequest.head.sha,
        });
      }
      await (options.prepareResources ?? preparePreviewResources)(
        {
          ...options,
          repoId: repoId ?? pullRequest.base.repo.id,
          pullNumber: pullRequest.number,
          ref: previewRef(pullRequest),
          vercelToken,
          teamId,
        },
        deployTargets(networks),
      );
      const result = await settlePreviewDeployments({
        networks,
        git: previewGitSource(pullRequest, repoId),
        vercelToken,
        teamId,
        fetchImpl,
        createDeployment,
        pollDeployment,
      });
      await react("rocket");
      // Vercel comments only on PRs whose branch it built; a fork builds ours.
      // The deploy is done, so a failed comment must not report it failed.
      if (fork) {
        try {
          await (options.upsertPreviewComment ?? upsertForkPreviewComment)({
            fetchImpl,
            githubToken,
            repoOwner,
            repoName,
            issueNumber,
            deployments: result.deployments,
            sha: pullRequest.head.sha,
          });
        } catch (error) {
          console.warn(
            `Fork preview comment failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return result;
    },
  });
}

export async function runPreviewFromGithubEvent(options) {
  const { eventName, event, ...rest } = options;
  if (eventName !== "issue_comment" || event.action !== "created") {
    return { kind: "ignore" };
  }
  return runPreviewDeployComment(commentCommandOptions(event, rest));
}

/** The fields a PR comment command reads from an `issue_comment` event. */
export function commentCommandOptions(event, options = {}) {
  return {
    ...options,
    commentBody: options.commentBody ?? event.comment.body,
    commentAuthor: options.commentAuthor ?? event.comment.user.login,
    commentId: options.commentId ?? event.comment.id,
    isPullRequest: options.isPullRequest ?? Boolean(event.issue?.pull_request),
    issueNumber: options.issueNumber ?? event.issue.number,
    repoId: options.repoId ?? event.repository?.id,
  };
}

export function summarizeCliDeployResult(result) {
  if (!Array.isArray(result?.deployments)) {
    return result;
  }
  return {
    kind: result.kind,
    deployments: result.deployments.map((deployment) => ({
      id: deployment.id,
      name: deployment.name,
      readyState: deployment.readyState,
    })),
  };
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

/** The event, tokens, and repository fields every Actions entry point needs. */
export async function readActionsContext(env = process.env) {
  requireVercelToken(env);
  if (!env.GITHUB_REPOSITORY) {
    throw new Error("GitHub Actions event context is required");
  }
  const event = await readGithubEvent(env);
  const [repoOwner, repoName] = env.GITHUB_REPOSITORY.split("/");
  return {
    event,
    repoOwner,
    repoName,
    repoId: event.repository.id,
    vercelToken: env.VERCEL_TOKEN,
    githubToken: env.GITHUB_TOKEN,
    teamId: env.VERCEL_ORG_ID ?? VERCEL_TEAM_ID,
  };
}

async function cliPreview(env = process.env) {
  const { event, ...context } = await readActionsContext(env);
  const result = await runPreviewFromGithubEvent({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    ...context,
  });
  console.log(JSON.stringify(summarizeCliDeployResult(result)));
}

export function isMainModule(moduleUrl = import.meta.url) {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === moduleUrl;
}

if (isMainModule()) {
  const command = process.argv[2];
  if (command === "preview") {
    await cliPreview();
  } else {
    console.error("Usage: node scripts/ci/vercel-deploy.mjs preview");
    process.exit(1);
  }
}
