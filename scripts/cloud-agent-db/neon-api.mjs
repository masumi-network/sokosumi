/** Minimal Neon API client for Cloud agent branch lifecycle. */

const NEON_API_BASE = "https://console.neon.tech/api/v2";

/**
 * @typedef {object} NeonConfig
 * @property {string} apiKey
 * @property {string} projectId
 * @property {string} [parentBranchName]
 * @property {string} [databaseName]
 * @property {string} [roleName]
 */

/**
 * @param {Partial<NodeJS.ProcessEnv>} [env]
 * @returns {NeonConfig | null}
 */
export function readNeonConfig(env = process.env) {
  const apiKey = env.NEON_API_KEY?.trim();
  const projectId = env.NEON_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    projectId,
    parentBranchName: env.NEON_PARENT_BRANCH?.trim() || "main",
    databaseName: env.NEON_DATABASE_NAME?.trim() || "neondb",
    roleName: env.NEON_ROLE_NAME?.trim() || "neondb_owner",
  };
}

/**
 * @param {NeonConfig} config
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function neonFetch(config, path, init = {}) {
  const response = await fetch(`${NEON_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  /** @type {unknown} */
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof body === "object" && body && "message" in body
        ? String(body.message)
        : text || response.statusText;
    const error = new Error(
      `Neon API ${init.method ?? "GET"} ${path} failed (${response.status}): ${detail}`,
    );
    // @ts-expect-error attach status for callers
    error.status = response.status;
    // @ts-expect-error attach body for callers
    error.body = body;
    throw error;
  }

  return body;
}

/**
 * @param {NeonConfig} config
 * @returns {Promise<object[]>}
 */
export async function listBranches(config) {
  const body = await neonFetch(
    config,
    `/projects/${config.projectId}/branches`,
  );
  return body?.branches ?? [];
}

/**
 * @param {NeonConfig} config
 * @param {string} name
 */
export async function findBranchByName(config, name) {
  const branches = await listBranches(config);
  return branches.find((branch) => branch.name === name) ?? null;
}

/**
 * Resolve production parent branch. Never returns an agent child branch.
 * @param {NeonConfig} config
 * @param {(name: string) => boolean} isAgentName
 */
export async function resolveParentBranch(config, isAgentName) {
  const branches = await listBranches(config);
  const parentName = config.parentBranchName || "main";
  const parent =
    branches.find((branch) => branch.name === parentName) ??
    branches.find((branch) => branch.default === true) ??
    null;

  if (!parent) {
    throw new Error(
      `Neon parent branch "${parentName}" not found in project ${config.projectId}`,
    );
  }

  if (isAgentName(parent.name)) {
    throw new Error(
      `Refusing to use agent branch "${parent.name}" as parent; set NEON_PARENT_BRANCH to production/main`,
    );
  }

  if (parent.protected === false && parent.default !== true) {
    // Non-default unprotected parents are allowed only when explicitly named
    // (e.g. a dedicated "production" branch). Default/main is preferred.
  }

  return parent;
}

/**
 * @param {NeonConfig} config
 * @param {{ name: string, parentId: string, expiresAt: string }} input
 */
export async function createAgentBranch(config, input) {
  return neonFetch(config, `/projects/${config.projectId}/branches`, {
    method: "POST",
    body: JSON.stringify({
      branch: {
        name: input.name,
        parent_id: input.parentId,
        expires_at: input.expiresAt,
      },
      endpoints: [{ type: "read_write" }],
    }),
  });
}

/**
 * @param {NeonConfig} config
 * @param {string} branchId
 * @param {{ expiresAt: string }} input
 */
export async function refreshBranchExpiration(config, branchId, input) {
  return neonFetch(
    config,
    `/projects/${config.projectId}/branches/${branchId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expires_at: input.expiresAt,
      }),
    },
  );
}

/**
 * @param {NeonConfig} config
 * @param {string} branchId
 */
export async function deleteBranch(config, branchId) {
  return neonFetch(
    config,
    `/projects/${config.projectId}/branches/${branchId}`,
    { method: "DELETE" },
  );
}

/**
 * @param {NeonConfig} config
 * @param {{ branchId: string, pooled: boolean }} input
 * @returns {Promise<string>}
 */
export async function getConnectionUri(config, input) {
  const params = new URLSearchParams({
    branch_id: input.branchId,
    database_name: config.databaseName || "neondb",
    role_name: config.roleName || "neondb_owner",
    pooled: input.pooled ? "true" : "false",
  });
  const body = await neonFetch(
    config,
    `/projects/${config.projectId}/connection_uri?${params}`,
  );
  const uri = body?.uri ?? body?.connection_uri;
  if (!uri || typeof uri !== "string") {
    throw new Error(
      `Neon connection_uri missing for branch ${input.branchId} (pooled=${input.pooled})`,
    );
  }
  return uri;
}

/**
 * @param {NeonConfig} config
 * @param {string} branchId
 * @returns {Promise<{ databaseUrl: string, databaseUrlUnpooled: string }>}
 */
export async function getBranchConnectionUrls(config, branchId) {
  const [databaseUrl, databaseUrlUnpooled] = await Promise.all([
    getConnectionUri(config, { branchId, pooled: true }),
    getConnectionUri(config, { branchId, pooled: false }),
  ]);
  return { databaseUrl, databaseUrlUnpooled };
}
