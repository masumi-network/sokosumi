/** Minimal Neon API client for Cloud agent branches and preview resets. */

const NEON_API_BASE = "https://console.neon.tech/api/v2";
// The branch list is paged and its docs give no default page size, so ask for
// the documented maximum.
const BRANCH_LIST_LIMIT = 10_000;

/**
 * @typedef {object} NeonConfig
 * @property {string} apiKey
 * @property {string} projectId
 * @property {string} [parentBranchName]
 * @property {string} [databaseName]
 * @property {string} [roleName]
 * @property {typeof fetch} [fetchImpl]
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
  const response = await (config.fetchImpl ?? fetch)(
    `${NEON_API_BASE}${path}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );

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
    // @ts-expect-error attach Neon's message for callers
    error.detail = detail;
    throw error;
  }

  return body;
}

/**
 * @param {NeonConfig} config
 * @param {string} [search] partial branch name or id; Neon filters server-side
 * @returns {Promise<object[]>}
 */
export async function listBranches(config, search) {
  const query = new URLSearchParams({ limit: String(BRANCH_LIST_LIMIT) });
  if (search) query.set("search", search);
  const body = await neonFetch(
    config,
    `/projects/${config.projectId}/branches?${query}`,
  );
  return body?.branches ?? [];
}

/**
 * @param {NeonConfig} config
 * @param {string} name
 */
export async function findBranchByName(config, name) {
  const branches = await listBranches(config, name);
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

export const PREVIEW_BRANCH_PREFIX = "preview/";
const OPERATION_SUCCEEDED = new Set(["finished", "skipped"]);
const OPERATION_FAILED = new Set(["failed", "error", "cancelled"]);
// Neon answers 423 while another operation holds the project. Its docs retry
// after 100 ms, doubling the wait each time, for at most five attempts.
const LOCKED_STATUS = 423;
const LOCKED_ATTEMPTS = 5;
const LOCKED_FIRST_DELAY_MS = 100;
const TOO_MANY_REQUESTS_STATUS = 429;
const FIRST_SERVER_ERROR_STATUS = 500;
// Neon's API spec says a 503 is always safe to retry, so Neon did not act.
const SERVICE_UNAVAILABLE_STATUS = 503;
const OPERATION_POLL_INTERVAL_MS = 5000;
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Throw unless `branch` is a Vercel preview branch that a reset may replace.
 * @param {{ name: string, parent_id?: string, default?: boolean, protected?: boolean }} branch
 */
export function assertPreviewBranchResettable(branch) {
  if (!branch.name?.startsWith(PREVIEW_BRANCH_PREFIX)) {
    throw new Error(`Refusing to reset non-preview branch "${branch.name}"`);
  }
  if (branch.default === true || branch.protected === true) {
    throw new Error(
      `Refusing to reset protected/default branch "${branch.name}"`,
    );
  }
  if (!branch.parent_id) {
    throw new Error(`Branch "${branch.name}" has no parent to reset from`);
  }
}

/**
 * Reset a Vercel preview branch (`preview/<git branch>`) to its parent's
 * current state. Its data is discarded; its id and connection strings stay.
 * @param {NeonConfig} config
 * @param {{ id: string, name: string, parent_id?: string, default?: boolean, protected?: boolean }} branch
 * @param {{ sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ operations?: { id: string, status?: string }[] }>}
 */
export async function resetPreviewBranchToParent(
  config,
  branch,
  { sleep = defaultSleep } = {},
) {
  assertPreviewBranchResettable(branch);

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await neonFetch(
        config,
        `/projects/${config.projectId}/branches/${branch.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ source_branch_id: branch.parent_id }),
        },
      );
    } catch (error) {
      if (error?.status !== LOCKED_STATUS || attempt >= LOCKED_ATTEMPTS) {
        throw error;
      }
      await sleep(LOCKED_FIRST_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * The error without the request path, which names the project and branch ids:
 * Neon's status and message, or the network error.
 * @param {unknown} error
 */
export function neonErrorReason(error) {
  if (error?.status === undefined) {
    return error instanceof Error ? error.message : String(error);
  }
  return `Neon answered ${error.status}: ${error.detail}`;
}

/**
 * A network error or a server error other than 503 leaves open whether Neon
 * acted on the request. Any other error status means that Neon did not act.
 * @param {unknown} error
 */
export function isUnknownNeonOutcome(error) {
  const status = error?.status;
  return (
    status === undefined ||
    (status >= FIRST_SERVER_ERROR_STATUS &&
      status !== SERVICE_UNAVAILABLE_STATUS)
  );
}

/**
 * Neon did not act because it was busy: the project was locked, the request
 * rate was limited, or the service was unavailable. Sending the request later
 * can succeed.
 * @param {unknown} error
 */
export function isNeonBusy(error) {
  return (
    error?.status === LOCKED_STATUS ||
    error?.status === TOO_MANY_REQUESTS_STATUS ||
    error?.status === SERVICE_UNAVAILABLE_STATUS
  );
}

/**
 * A request worth sending again: its outcome is unknown, Neon limited the
 * request rate, or the service was unavailable.
 * @param {unknown} error
 */
function isTransientNeonError(error) {
  return (
    isUnknownNeonOutcome(error) ||
    error?.status === TOO_MANY_REQUESTS_STATUS ||
    error?.status === SERVICE_UNAVAILABLE_STATUS
  );
}

/**
 * Poll operations until each one succeeds. Throws on a failed operation, on a
 * poll error that is not transient, or when `timeoutMs` passes first.
 * @param {NeonConfig} config
 * @param {{ id: string, status?: string }[]} operations
 * @param {{ sleep?: (ms: number) => Promise<void>, now?: () => number, intervalMs?: number, timeoutMs?: number }} [options]
 */
export async function waitForOperations(
  config,
  operations,
  {
    sleep = defaultSleep,
    now = Date.now,
    intervalMs = OPERATION_POLL_INTERVAL_MS,
    timeoutMs = OPERATION_TIMEOUT_MS,
  } = {},
) {
  const deadline = now() + timeoutMs;
  for (const operation of operations) {
    let status = operation.status;
    let pollError;
    // The status from the restore reply can be old, so an operation is polled
    // at least once before the deadline can fail it.
    let polled = false;
    while (!OPERATION_SUCCEEDED.has(status ?? "")) {
      if (OPERATION_FAILED.has(status ?? "")) {
        throw new Error(`Neon operation ${operation.id} ended ${status}`);
      }
      if (polled && now() >= deadline) {
        const last = pollError
          ? `last poll failed: ${neonErrorReason(pollError)}`
          : `last status: ${status ?? "unknown"}`;
        throw new Error(
          `Neon operation ${operation.id} did not finish (${last})`,
        );
      }
      await sleep(intervalMs);
      polled = true;
      // A failed poll says nothing about the operation, so it polls again.
      try {
        const body = await neonFetch(
          config,
          `/projects/${config.projectId}/operations/${operation.id}`,
        );
        status = body?.operation?.status;
        pollError = undefined;
      } catch (error) {
        if (!isTransientNeonError(error)) {
          throw error;
        }
        pollError = error;
      }
    }
  }
}
