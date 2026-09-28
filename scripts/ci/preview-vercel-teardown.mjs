/**
 * Delete a closed pull request's Vercel preview deployments in every
 * web and Core project. Called by preview-branch-teardown.mjs, which has
 * already skipped fork heads, the default branch, and refs that an open
 * pull request still uses.
 */

import { VERCEL_PROJECTS, vercelAuthHeaders } from "./vercel-deploy.mjs";

const VERCEL_API = "https://api.vercel.com";
const PAGE_LIMIT = 100;
export const NOT_FOUND_STATUS = 404;

/** @param {unknown} error */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} VercelClient
 * @property {string} token
 * @property {string} teamId
 * @property {typeof fetch} fetchImpl
 */

/**
 * The project's non-production deployments whose git ref is `ref`. The
 * `branch` query narrows the list; the `meta.githubCommitRef` check keeps
 * the match exact.
 * @param {VercelClient} vercel
 * @param {{ projectId: string, ref: string }} input
 */
export async function listRefPreviews(vercel, { projectId, ref }) {
  const found = [];
  let until;
  for (;;) {
    const url = new URL(`${VERCEL_API}/v7/deployments`);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("teamId", vercel.teamId);
    url.searchParams.set("branch", ref);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (until !== undefined) url.searchParams.set("until", String(until));
    const response = await vercel.fetchImpl(url, {
      headers: vercelAuthHeaders(vercel.token),
    });
    if (!response.ok) {
      throw new Error(
        `Vercel deployment list failed (${response.status}): ${await response.text()}`,
      );
    }
    const body = await response.json();
    for (const deployment of body.deployments ?? []) {
      if (deployment.target === "production") continue;
      if (deployment.meta?.githubCommitRef !== ref) continue;
      found.push(deployment);
    }
    const next = body.pagination?.next;
    if (!next || next === until) return found;
    until = next;
  }
}

/**
 * @param {VercelClient} vercel
 * @param {{ ref: string, log: (line: string) => void }} input
 * @returns {Promise<boolean>} false when a list or delete failed
 */
export async function deleteVercelPreviews(vercel, { ref, log }) {
  let ok = true;
  for (const [network, apps] of Object.entries(VERCEL_PROJECTS)) {
    for (const { id: projectId, name } of Object.values(apps)) {
      try {
        const previews = await listRefPreviews(vercel, { projectId, ref });
        for (const { uid } of previews) {
          const url = new URL(`${VERCEL_API}/v13/deployments/${uid}`);
          url.searchParams.set("teamId", vercel.teamId);
          try {
            const response = await vercel.fetchImpl(url, {
              method: "DELETE",
              headers: vercelAuthHeaders(vercel.token),
            });
            if (!response.ok && response.status !== NOT_FOUND_STATUS) {
              throw new Error(`status ${response.status}`);
            }
            log(`${name}: deleted ${uid}`);
          } catch (error) {
            ok = false;
            log(`${name}: failed to delete ${uid}: ${errorMessage(error)}`);
          }
        }
        if (previews.length === 0) log(`${name}: no previews for ${ref}`);
      } catch (error) {
        ok = false;
        log(`${network} ${name}: ${errorMessage(error)}`);
      }
    }
  }
  return ok;
}
