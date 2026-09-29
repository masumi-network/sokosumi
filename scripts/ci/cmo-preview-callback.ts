/**
 * CMO's OAuth client accepts exact redirect URIs only (ADR 0045), and every
 * pull request preview has its own host. After `/deploy mainnet`, CI adds the
 * CMO preview's callback to CMO's mainnet client row in that pull request's
 * throwaway Neon preview branch. Mainnet itself is never written.
 */

import { SOKOSUMI_OAUTH_CALLBACK_PATH } from "../../apps/cmo/src/lib/sokosumi-oauth.ts";
import {
  assertPreviewBranchResettable,
  findBranchByName,
  getConnectionUri,
  neonErrorReason,
} from "../cloud-agent-db/neon-api.mjs";
import {
  type PreviewIdentity,
  previewBranchName,
  previewNeonConfigs,
} from "./preview-resources.ts";

/** GitHub variable with the client id of CMO's OAuth client on mainnet. */
export const CMO_CLIENT_ID_VARIABLE = "CMO_OAUTH_CLIENT_ID_MAINNET";

interface PreviewRedirectInput {
  branch: Branch;
  previewUrl: string;
  redirectUris: string[];
}

interface CmoPreviewCallbackOptions extends PreviewIdentity {
  previewUrl: string;
  neonEnv?: NodeJS.ProcessEnv;
  neonFetchImpl?: typeof fetch;
}

interface Branch {
  id: string;
  name: string;
  parent_id?: string;
  default?: boolean;
  protected?: boolean;
}

/**
 * The callback URL for the CMO preview at `previewUrl`, and the client's new
 * redirect URIs, or null when they already list the callback. Throws unless
 * `branch` is a preview branch the reset guard accepts.
 */
export function planPreviewRedirectUris({
  branch,
  previewUrl,
  redirectUris,
}: PreviewRedirectInput) {
  assertPreviewBranchResettable(branch);
  const origin = new URL(previewUrl);
  // Only Vercel's git branch alias stays the same across deploys, and CMO
  // uses it as its base URL (VERCEL_BRANCH_URL). A per-deployment URL would
  // add a new entry on every deploy.
  if (
    origin.protocol !== "https:" ||
    origin.hostname.includes("*") ||
    !origin.hostname.includes("-git-")
  ) {
    throw new Error(`${previewUrl} is not a CMO preview branch URL`);
  }
  const callbackUrl = new URL(SOKOSUMI_OAUTH_CALLBACK_PATH, origin).href;
  return {
    callbackUrl,
    redirectUris: redirectUris.includes(callbackUrl)
      ? null
      : [...redirectUris, callbackUrl],
  };
}

/**
 * Run one statement through Neon's SQL over HTTP, which the serverless driver
 * uses, so CI needs no Postgres client. Values come back as text.
 */
async function neonSql(
  fetchImpl: typeof fetch,
  connectionUri: string,
  query: string,
  params: string[],
): Promise<Record<string, string | null>[]> {
  const host = new URL(connectionUri).hostname.replace(/^[^.]+\./, "api.");
  const response = await fetchImpl(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": connectionUri,
      "Neon-Raw-Text-Output": "true",
    },
    body: JSON.stringify({ query, params }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `the preview database answered ${response.status}: ${body?.message ?? "no message"}`,
    );
  }
  return body?.rows ?? [];
}

export async function registerCmoPreviewCallback(
  options: CmoPreviewCallbackOptions,
) {
  const clientId = (options.neonEnv ?? process.env)[
    CMO_CLIENT_ID_VARIABLE
  ]?.trim();
  if (!clientId) {
    console.warn(
      `${CMO_CLIENT_ID_VARIABLE} is not set, so CMO previews cannot sign in.`,
    );
    return { kind: "unconfigured" as const };
  }
  const [{ config }] = previewNeonConfigs(options, ["mainnet"]);
  const name = previewBranchName(options);
  try {
    const branch = await findBranchByName(config, name);
    if (!branch) {
      throw new Error(
        `No Neon branch \`${name}\` in the mainnet preview project`,
      );
    }
    // The reset's guard, before any connection string exists.
    assertPreviewBranchResettable(branch);
    const connectionUri = await getConnectionUri(config, {
      branchId: branch.id,
      pooled: false,
    });
    const sql = (query: string, params: string[]) =>
      neonSql(config.fetchImpl, connectionUri, query, params);
    const [client] = await sql(
      `SELECT array_to_json("redirectUris")::text AS "redirectUris" FROM "oauthClient" WHERE "clientId" = $1`,
      [clientId],
    );
    if (!client) {
      throw new Error(
        `CMO's OAuth client \`${clientId}\` is not in \`${name}\`. If mainnet has the client, the branch is older than it: comment \`/deploy mainnet --reset-db\` to copy it from mainnet. Otherwise register it at /developer on mainnet first`,
      );
    }
    const plan = planPreviewRedirectUris({
      branch,
      previewUrl: options.previewUrl,
      redirectUris: JSON.parse(client.redirectUris ?? "[]"),
    });
    if (!plan.redirectUris) {
      return { kind: "unchanged" as const, callbackUrl: plan.callbackUrl };
    }
    await sql(
      `UPDATE "oauthClient" SET "redirectUris" = ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), "updatedAt" = now() WHERE "clientId" = $1`,
      [clientId, JSON.stringify(plan.redirectUris)],
    );
    return { kind: "added" as const, callbackUrl: plan.callbackUrl };
  } catch (error) {
    // Neon API errors name the project and branch ids; the reply is public.
    throw new Error(neonErrorReason(error));
  }
}
