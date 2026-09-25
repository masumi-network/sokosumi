#!/usr/bin/env node
/**
 * `/reset-db <mainnet|preprod>` or `/reset-db all` on a pull request resets
 * the PR's Neon preview branch (`preview/<head ref>`) to its parent, then
 * redeploys Core so its Vercel build runs `prisma migrate deploy` on the
 * clean branch. Use it after renaming a migration that the preview database
 * already applied. `/deploy <networks> --reset-db` does the same reset, then
 * deploys web and Core like `/deploy`.
 *
 *   node scripts/ci/preview-db-reset.mjs    # `reset-db` job in preview-deploy.yml
 */

import {
  assertPreviewBranchResettable,
  findBranchByName,
  isNeonBusy,
  isUnknownNeonOutcome,
  neonErrorReason,
  PREVIEW_BRANCH_PREFIX,
  resetPreviewBranchToParent,
  waitForOperations,
} from "../cloud-agent-db/neon-api.mjs";
import {
  commentCommandOptions,
  isMainModule,
  parseNetworkCommand,
  previewGitSource,
  readActionsContext,
  runPreviewDeployComment,
  runPullRequestCommand,
  settlePreviewDeployments,
  summarizeCliDeployResult,
  usageMessage,
  VERCEL_TEAM_ID,
} from "./vercel-deploy.mjs";

// Node's fetch can wait 300 seconds for a response. A hung Neon request would
// then run the job into its timeout, and no reply would post.
const NEON_REQUEST_TIMEOUT_MS = 30_000;

export const RESET_DB_FLAG = "--reset-db";

/**
 * The comment's first line without `--reset-db`, or null when that line is
 * not a `/deploy` command with the flag. Commands read only the first line.
 */
export function stripResetDbFlag(body) {
  // trim() also drops a leading byte order mark.
  const text = String(body ?? "");
  const end = text.search(/\r?\n/);
  const tokens = (end === -1 ? text : text.slice(0, end)).trim().split(/\s+/);
  const kept = tokens.filter((token) => token.toLowerCase() !== RESET_DB_FLAG);
  if (tokens[0].toLowerCase() !== "/deploy" || kept.length === tokens.length) {
    return null;
  }
  return kept.join(" ");
}

export function apiKeyVariable(network) {
  return `NEON_PREVIEW_API_KEY_${network.toUpperCase()}`;
}

export function projectIdVariable(network) {
  return `NEON_PREVIEW_PROJECT_ID_${network.toUpperCase()}`;
}

export function resetUsageMessage() {
  return [
    "Usage: `/reset-db <mainnet|preprod> [mainnet|preprod]` or `/reset-db all`",
    "",
    "`/reset-db mainnet`",
    "`/reset-db preprod`",
    "`/reset-db all`",
    "",
    `Resets this PR's Neon preview branch (\`${PREVIEW_BRANCH_PREFIX}<branch>\`) to a copy of its parent, then redeploys Core for the named network(s). The build applies every migration the parent lacks, this PR's included. Data written only to that preview database is lost.`,
  ].join("\n");
}

function requiredEnv(env, variable) {
  const value = env[variable]?.trim();
  if (!value) {
    throw new Error(`${variable} is not set`);
  }
  return value;
}

/** Neon config per network, each with its own project-scoped key. */
export function readPreviewNeonConfigs(env, networks) {
  return networks.map((network) => ({
    network,
    config: {
      apiKey: requiredEnv(env, apiKeyVariable(network)),
      projectId: requiredEnv(env, projectIdVariable(network)),
    },
  }));
}

/** The error's message as a sentence that ends with one period. */
function errorSentence(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.endsWith(".") ? message : `${message}.`;
}

/** The error sentence, labelled with the network it came from. */
function networkError(network, error) {
  return `${network}: ${errorSentence(error)}`;
}

/**
 * Run one Neon step. Its error names the step and leaves out the request
 * path, because the reply is a public PR comment. It keeps the status that
 * tells whether Neon acted.
 */
async function neonStep(step, request) {
  try {
    return await request();
  } catch (error) {
    throw Object.assign(
      new Error(`${step} failed: ${neonErrorReason(error)}`),
      { status: error?.status },
    );
  }
}

/** The `/reset-db` command: reset, then redeploy Core only. */
const RESET_DB_COMMAND = {
  name: "/reset-db",
  subject: "`/reset-db`",
  apps: ["core"],
  redeploy: "Core redeploy",
  deployed: "redeployed Core",
  retry: (networks) => `/reset-db ${networks.join(" ")}`,
};

/** `/deploy --reset-db`: reset, then deploy web and Core like `/deploy`. */
const DEPLOY_RESET_COMMAND = {
  name: "/deploy",
  subject: "Preview deploy",
  apps: undefined,
  redeploy: "web and Core deploy",
  deployed: "deployed web and Core",
  retry: (networks) => `/deploy ${networks.join(" ")} ${RESET_DB_FLAG}`,
};

export function runPreviewDbResetComment(options) {
  return runResetCommand(options, RESET_DB_COMMAND, resetUsageMessage());
}

/**
 * Run `/deploy <networks> --reset-db`. The workflow sends a `/deploy` comment
 * here whenever its body holds the flag, so a comment with the flag on a
 * later line runs a plain `/deploy`.
 */
export function runDeployWithResetComment(options) {
  const commentBody = stripResetDbFlag(options.commentBody);
  if (commentBody === null) {
    return runPreviewDeployComment(options);
  }
  return runResetCommand(
    { ...options, commentBody },
    DEPLOY_RESET_COMMAND,
    usageMessage(),
  );
}

/** The `reset-db` job's entry: `/deploy` comments and `/reset-db` comments. */
export function runResetDbJobComment(options) {
  return parseNetworkCommand(options.commentBody, "/deploy").kind === "ignore"
    ? runPreviewDbResetComment(options)
    : runDeployWithResetComment(options);
}

async function runResetCommand(options, command, usage) {
  const {
    repoId,
    vercelToken,
    teamId = VERCEL_TEAM_ID,
    fetchImpl = globalThis.fetch,
    neonEnv = process.env,
    neonFetchImpl,
    sleep,
    createDeployment,
    pollDeployment,
  } = options;

  return runPullRequestCommand(options, {
    name: command.name,
    subject: command.subject,
    action: "reset preview databases",
    usage,
    run: async ({ networks, pullRequest, comment, react }) => {
      const branchName = `${PREVIEW_BRANCH_PREFIX}${pullRequest.head.ref}`;
      const fetchWithTimeout = (url, init) =>
        (neonFetchImpl ?? globalThis.fetch)(url, {
          ...init,
          signal: AbortSignal.timeout(NEON_REQUEST_TIMEOUT_MS),
        });

      // Check every network before resetting any, so a failure on the second
      // network cannot leave the first one reset.
      const targets = [];
      let checking;
      try {
        for (const { network, config } of readPreviewNeonConfigs(
          neonEnv,
          networks,
        )) {
          checking = network;
          const neon = { ...config, fetchImpl: fetchWithTimeout };
          const branch = await neonStep("the branch lookup", () =>
            findBranchByName(neon, branchName),
          );
          if (!branch) {
            throw new Error(
              `No Neon branch \`${branchName}\` in the preview project. A Core preview deployment of this branch creates it`,
            );
          }
          assertPreviewBranchResettable(branch);
          targets.push({ network, neon, branch });
        }
      } catch (error) {
        // A missing key or project id fails before any network is checked,
        // and its variable name already says which network.
        const sentence = checking
          ? networkError(checking, error)
          : errorSentence(error);
        throw new Error(`${sentence} Nothing was reset.`);
      }

      // Networks in `reset` finished. The one that failed may be half done:
      // Neon accepted its restore, or the request failed in a way that leaves
      // open whether Neon acted on it. The networks after it did not start.
      const reset = [];
      let restoreAccepted = false;
      try {
        for (const { network, neon, branch } of targets) {
          restoreAccepted = false;
          const restored = await neonStep("the restore", () =>
            resetPreviewBranchToParent(neon, branch, { sleep }),
          );
          restoreAccepted = true;
          await neonStep("waiting for the restore", () =>
            waitForOperations(neon, restored?.operations ?? [], { sleep }),
          );
          reset.push(network);
        }
      } catch (error) {
        const [failed, ...untried] = targets
          .slice(reset.length)
          .map(({ network }) => network);
        const unfinished = restoreAccepted || isUnknownNeonOutcome(error);
        const notes = [networkError(failed, error)];
        if (reset.length > 0) {
          notes.push(
            `\`${branchName}\` was reset on ${reset.join(", ")} without a ${command.redeploy}. Comment \`/deploy ${reset.join(" ")}\` to run the migrations.`,
          );
        }
        const busy = !unfinished && isNeonBusy(error);
        if (unfinished) {
          notes.push(`The reset on ${failed} may not have finished.`);
        } else if (busy) {
          notes.push(`Neon was busy and did not reset ${failed}.`);
        } else {
          notes.push(`Neon refused the reset on ${failed}.`);
        }
        if (reset.length === 0 && !unfinished) {
          notes.push("Nothing was reset.");
        } else if (untried.length > 0) {
          notes.push(`The reset on ${untried.join(", ")} did not start.`);
        }
        // A refusal repeats until its cause changes, for example a branch
        // with children.
        const retry = `\`${command.retry([failed, ...untried])}\``;
        notes.push(
          unfinished || busy
            ? `Comment ${retry} to try again.`
            : `Comment ${retry} once the cause is fixed.`,
        );
        throw new Error(notes.join(" "));
      }

      let deployments;
      try {
        ({ deployments } = await settlePreviewDeployments({
          networks,
          apps: command.apps,
          git: previewGitSource(pullRequest, repoId),
          vercelToken,
          teamId,
          fetchImpl,
          createDeployment,
          pollDeployment,
        }));
      } catch (error) {
        // A failed build names its networks and apps. A failed Vercel
        // request does not, so every network may lack its migrations.
        const failed = error?.networks ?? networks;
        const next =
          error?.apps?.includes("core") === false
            ? `Core ran the migrations. Comment \`/deploy ${failed.join(" ")}\` to deploy again.`
            : `If \`prisma migrate deploy\` failed in the build log, fix the migration first. Then comment \`/deploy ${failed.join(" ")}\` to run the migrations.`;
        throw new Error(
          `\`${branchName}\` was reset on ${networks.join(", ")}, but the ${command.redeploy} failed: ${errorSentence(error)} ${next}`,
        );
      }

      // The work is done, so a failed reply or reaction must not become a
      // "failed" reply that invites a second reset.
      try {
        await comment(
          `Reset \`${branchName}\` to its parent on ${networks.join(", ")} and ${command.deployed}. The Core build ran \`prisma migrate deploy\` on the clean branch.`,
        );
      } catch (error) {
        console.warn(`Success reply failed: ${errorSentence(error)}`);
      }
      try {
        await react("rocket");
      } catch (error) {
        console.warn(`Rocket reaction failed: ${errorSentence(error)}`);
      }
      return { kind: "reset", branchName, deployments };
    },
  });
}

async function cliResetDb(env = process.env) {
  const { event, ...context } = await readActionsContext(env);
  const result = await runResetDbJobComment(
    commentCommandOptions(event, { ...context, neonEnv: env }),
  );
  console.log(JSON.stringify(summarizeCliDeployResult(result)));
}

if (isMainModule(import.meta.url)) {
  await cliResetDb();
}
