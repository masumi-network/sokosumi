#!/usr/bin/env node
/**
 * `/reset-db <mainnet|preprod>` or `/reset-db all` on a pull request resets
 * the PR's Neon preview branch (`preview/<head ref>`) to its parent, then
 * redeploys Core so its Vercel build runs `prisma migrate deploy` on the
 * clean branch. Use it after renaming a migration that the preview database
 * already applied.
 *
 *   node scripts/ci/preview-db-reset.mjs    # `reset-db` job in preview-deploy.yml
 */

import {
  assertPreviewBranchResettable,
  findBranchByName,
  isNeonBusy,
  isUnknownNeonOutcome,
  PREVIEW_BRANCH_PREFIX,
  resetPreviewBranchToParent,
  waitForOperations,
} from "../cloud-agent-db/neon-api.mjs";
import {
  commentCommandOptions,
  isMainModule,
  previewGitSource,
  readActionsContext,
  runPullRequestCommand,
  settlePreviewDeployments,
  summarizeCliDeployResult,
  VERCEL_TEAM_ID,
} from "./vercel-deploy.mjs";

// Node's fetch can wait 300 seconds for a response. A hung Neon request would
// then run the job into its timeout, and no reply would post.
const NEON_REQUEST_TIMEOUT_MS = 30_000;

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

export async function runPreviewDbResetComment(options) {
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
    name: "/reset-db",
    subject: "`/reset-db`",
    action: "reset preview databases",
    usage: resetUsageMessage(),
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
          const branch = await findBranchByName(neon, branchName);
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
          const restored = await resetPreviewBranchToParent(neon, branch, {
            sleep,
          });
          restoreAccepted = true;
          await waitForOperations(neon, restored?.operations ?? [], { sleep });
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
            `\`${branchName}\` was reset on ${reset.join(", ")} without a Core redeploy. Comment \`/deploy ${reset.join(" ")}\` to run the migrations.`,
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
        const retry = `\`/reset-db ${[failed, ...untried].join(" ")}\``;
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
          apps: ["core"],
          git: previewGitSource(pullRequest, repoId),
          vercelToken,
          teamId,
          fetchImpl,
          createDeployment,
          pollDeployment,
        }));
      } catch (error) {
        throw new Error(
          `\`${branchName}\` was reset on ${networks.join(", ")}, but the Core redeploy failed: ${errorSentence(error)} Comment \`/deploy ${networks.join(" ")}\` to run the migrations.`,
        );
      }

      // The work is done, so a failed reply or reaction must not become a
      // "failed" reply that invites a second reset.
      try {
        await comment(
          `Reset \`${branchName}\` to its parent on ${networks.join(", ")} and redeployed Core. The Core build ran \`prisma migrate deploy\` on the clean branch.`,
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
  const result = await runPreviewDbResetComment(
    commentCommandOptions(event, { ...context, neonEnv: env }),
  );
  console.log(JSON.stringify(summarizeCliDeployResult(result)));
}

if (isMainModule(import.meta.url)) {
  await cliResetDb();
}
