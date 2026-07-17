/**
 * Preview-only Neon branch reset-from-parent before `prisma migrate deploy`.
 *
 * Vercel Neon preview branches keep prior schema/data across redeploys. Resetting
 * from parent before migrate makes each Preview build start from the parent's
 * head, then apply this deployment's migrations cleanly.
 *
 * Production / local: no-op. Preview without Neon API credentials: fail closed.
 */

export interface NeonPreviewResetEnv {
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
  /** Optional explicit Neon branch id (`br-…`). Skips name/host lookup. */
  NEON_BRANCH_ID?: string;
  DATABASE_URL_UNPOOLED?: string;
}

export type NeonPreviewResetPlan =
  | { action: "skip"; reason: string }
  | {
      action: "reset";
      apiKey: string;
      projectId: string;
      branchId?: string;
      branchName?: string;
      endpointHost?: string;
    }
  | { action: "error"; message: string };

export interface NeonApiFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface NeonPreviewResetDeps {
  fetch?: NeonApiFetch;
  sleep?: (ms: number) => Promise<void>;
  /** Max time to wait for Neon operations after restore. */
  operationTimeoutMs?: number;
  pollIntervalMs?: number;
  apiBaseUrl?: string;
  /** Neon HTTP attempts (including the first). Default 3. */
  maxAttempts?: number;
}

export interface NeonPreviewResetResult {
  branchId: string;
  branchName: string;
  parentBranchId: string;
  operationIds: string[];
}

const PREVIEW_MISSING_NEON_CREDS =
  "Preview migrate requires NEON_API_KEY and NEON_PROJECT_ID so the Neon branch can be reset from its parent before prisma migrate deploy. Set both on the Core Vercel project (Preview + Build).";

const PREVIEW_MISSING_BRANCH_REF =
  "Preview migrate could not resolve the Neon branch: set NEON_BRANCH_ID, or ensure VERCEL_GIT_COMMIT_REF / DATABASE_URL_UNPOOLED are available for lookup.";

const NEON_API_DEFAULT = "https://console.neon.tech/api/v2";

/**
 * Branch name used by the Neon-Managed Vercel integration:
 * `preview/<VERCEL_GIT_COMMIT_REF>`. Unusual refs may be sanitized by the
 * integration — prefer endpoint-host / `NEON_BRANCH_ID` when name lookup fails.
 */
export function previewNeonBranchName(gitCommitRef: string): string {
  return `preview/${gitCommitRef}`;
}

export function extractNeonEndpointHost(
  databaseUrl: string | undefined,
): string | undefined {
  const trimmed = databaseUrl?.trim();
  if (!trimmed) return undefined;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    if (!host.includes("neon.tech")) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

export function planNeonPreviewBranchReset(
  env: NeonPreviewResetEnv,
): NeonPreviewResetPlan {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview") {
    return {
      action: "skip",
      reason: "Neon branch reset runs only on Vercel Preview builds",
    };
  }

  const apiKey = env.NEON_API_KEY?.trim();
  const projectId = env.NEON_PROJECT_ID?.trim();
  if (!apiKey || !projectId) {
    return { action: "error", message: PREVIEW_MISSING_NEON_CREDS };
  }

  const branchId = env.NEON_BRANCH_ID?.trim() || undefined;
  const gitRef = env.VERCEL_GIT_COMMIT_REF?.trim() || undefined;
  const branchName = gitRef ? previewNeonBranchName(gitRef) : undefined;
  const endpointHost = extractNeonEndpointHost(env.DATABASE_URL_UNPOOLED);

  if (!branchId && !branchName && !endpointHost) {
    return { action: "error", message: PREVIEW_MISSING_BRANCH_REF };
  }

  return {
    action: "reset",
    apiKey,
    projectId,
    branchId,
    branchName,
    endpointHost,
  };
}

interface NeonBranch {
  id: string;
  name: string;
  parent_id?: string | null;
}

interface NeonEndpoint {
  id: string;
  host: string;
  branch_id: string;
}

interface NeonOperation {
  id: string;
  status: string;
}

interface NeonListBranchesResponse {
  branches?: NeonBranch[];
}

interface NeonListEndpointsResponse {
  endpoints?: NeonEndpoint[];
}

interface NeonRestoreResponse {
  branch?: NeonBranch;
  operations?: NeonOperation[];
}

interface NeonGetOperationResponse {
  operation?: NeonOperation;
}

function isRetryableNeonStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function neonJson<T>(
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit | undefined,
  sleep: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchFn(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message = `Neon API ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body || response.statusText}`;
        if (
          !isRetryableNeonStatus(response.status) ||
          attempt === maxAttempts
        ) {
          throw new Error(message);
        }
        lastError = new Error(message);
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Neon API ")) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) break;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new Error(`Neon API ${path} failed after retries`);
}

async function findBranchByName(
  plan: Extract<NeonPreviewResetPlan, { action: "reset" }>,
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
  sleep: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<NeonBranch | undefined> {
  if (!plan.branchName) return undefined;
  const search = encodeURIComponent(plan.branchName);
  const data = await neonJson<NeonListBranchesResponse>(
    fetchFn,
    apiBaseUrl,
    plan.apiKey,
    `/projects/${plan.projectId}/branches?search=${search}`,
    undefined,
    sleep,
    maxAttempts,
  );
  return data.branches?.find((branch) => branch.name === plan.branchName);
}

async function findBranchByEndpointHost(
  plan: Extract<NeonPreviewResetPlan, { action: "reset" }>,
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
  sleep: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<NeonBranch | undefined> {
  if (!plan.endpointHost) return undefined;
  const data = await neonJson<NeonListEndpointsResponse>(
    fetchFn,
    apiBaseUrl,
    plan.apiKey,
    `/projects/${plan.projectId}/endpoints`,
    undefined,
    sleep,
    maxAttempts,
  );
  const endpoint = data.endpoints?.find(
    (item) => item.host.toLowerCase() === plan.endpointHost,
  );
  if (!endpoint?.branch_id) return undefined;

  const branchData = await neonJson<{ branch: NeonBranch }>(
    fetchFn,
    apiBaseUrl,
    plan.apiKey,
    `/projects/${plan.projectId}/branches/${endpoint.branch_id}`,
    undefined,
    sleep,
    maxAttempts,
  );
  return branchData.branch?.id ? branchData.branch : undefined;
}

/**
 * Resolve the preview branch Neon will reset.
 *
 * Prefer `NEON_BRANCH_ID`. When both name and endpoint host are known, require
 * they agree — otherwise prefer the host from `DATABASE_URL_UNPOOLED` (what
 * migrate deploy will hit) and log the mismatch via thrown context.
 */
async function resolveBranch(
  plan: Extract<NeonPreviewResetPlan, { action: "reset" }>,
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
  sleep: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<NeonBranch> {
  if (plan.branchId) {
    const data = await neonJson<{ branch: NeonBranch }>(
      fetchFn,
      apiBaseUrl,
      plan.apiKey,
      `/projects/${plan.projectId}/branches/${plan.branchId}`,
      undefined,
      sleep,
      maxAttempts,
    );
    if (!data.branch?.id) {
      throw new Error(`Neon branch ${plan.branchId} not found`);
    }
    return data.branch;
  }

  const byName = await findBranchByName(
    plan,
    fetchFn,
    apiBaseUrl,
    sleep,
    maxAttempts,
  );
  const byHost = await findBranchByEndpointHost(
    plan,
    fetchFn,
    apiBaseUrl,
    sleep,
    maxAttempts,
  );

  if (byName && byHost && byName.id !== byHost.id) {
    // DATABASE_URL_UNPOOLED is authoritative for which DB migrate will use.
    console.warn(
      `[neon-preview-reset] Branch name ${byName.name} (${byName.id}) does not match endpoint host ${plan.endpointHost} → ${byHost.name} (${byHost.id}); using endpoint-host branch`,
    );
    return byHost;
  }

  if (byName) return byName;
  if (byHost) return byHost;

  throw new Error(
    `Could not resolve Neon preview branch` +
      (plan.branchName ? ` (name=${plan.branchName})` : "") +
      (plan.endpointHost ? ` (host=${plan.endpointHost})` : ""),
  );
}

function isTerminalSuccess(status: string): boolean {
  return status === "finished" || status === "skipped";
}

function isTerminalFailure(status: string): boolean {
  return status === "failed" || status === "cancelled" || status === "error";
}

async function waitForOperations(options: {
  fetchFn: NeonApiFetch;
  apiBaseUrl: string;
  apiKey: string;
  projectId: string;
  operations: NeonOperation[];
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  pollIntervalMs: number;
  maxAttempts: number;
}): Promise<void> {
  const {
    fetchFn,
    apiBaseUrl,
    apiKey,
    projectId,
    operations,
    sleep,
    timeoutMs,
    pollIntervalMs,
    maxAttempts,
  } = options;

  const deadline = Date.now() + timeoutMs;

  for (const operation of operations) {
    let status = operation.status;
    while (!isTerminalSuccess(status)) {
      if (isTerminalFailure(status)) {
        throw new Error(
          `Neon operation ${operation.id} ended with status ${status}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for Neon operation ${operation.id} (last status: ${status})`,
        );
      }
      await sleep(pollIntervalMs);
      const data = await neonJson<NeonGetOperationResponse>(
        fetchFn,
        apiBaseUrl,
        apiKey,
        `/projects/${projectId}/operations/${operation.id}`,
        undefined,
        sleep,
        maxAttempts,
      );
      status = data.operation?.status ?? "unknown";
    }
  }
}

/**
 * When `plan.action === "reset"`, restore the preview branch from its parent and
 * wait for Neon operations to finish. Caller should run migrate deploy after.
 */
export async function resetNeonPreviewBranchFromParent(
  plan: NeonPreviewResetPlan,
  deps: NeonPreviewResetDeps = {},
): Promise<NeonPreviewResetResult | null> {
  if (plan.action === "skip") return null;
  if (plan.action === "error") throw new Error(plan.message);

  const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const apiBaseUrl = deps.apiBaseUrl ?? NEON_API_DEFAULT;
  const operationTimeoutMs = deps.operationTimeoutMs ?? 120_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 1_000;
  const maxAttempts = deps.maxAttempts ?? 3;

  const branch = await resolveBranch(
    plan,
    fetchFn,
    apiBaseUrl,
    sleep,
    maxAttempts,
  );
  const parentBranchId = branch.parent_id?.trim();
  if (!parentBranchId) {
    throw new Error(
      `Neon branch ${branch.id} (${branch.name}) has no parent_id; cannot reset from parent`,
    );
  }

  console.log(
    `[neon-preview-reset] Resolved branch ${branch.name} (${branch.id}); restoring from parent ${parentBranchId}`,
  );

  const restore = await neonJson<NeonRestoreResponse>(
    fetchFn,
    apiBaseUrl,
    plan.apiKey,
    `/projects/${plan.projectId}/branches/${branch.id}/restore`,
    {
      method: "POST",
      body: JSON.stringify({ source_branch_id: parentBranchId }),
    },
    sleep,
    maxAttempts,
  );

  const operations = restore.operations ?? [];
  if (operations.length > 0) {
    await waitForOperations({
      fetchFn,
      apiBaseUrl,
      apiKey: plan.apiKey,
      projectId: plan.projectId,
      operations,
      sleep,
      timeoutMs: operationTimeoutMs,
      pollIntervalMs,
      maxAttempts,
    });
  }

  return {
    branchId: branch.id,
    branchName: branch.name,
    parentBranchId,
    operationIds: operations.map((operation) => operation.id),
  };
}
