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

async function neonJson<T>(
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
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
    throw new Error(
      `Neon API ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

async function resolveBranch(
  plan: Extract<NeonPreviewResetPlan, { action: "reset" }>,
  fetchFn: NeonApiFetch,
  apiBaseUrl: string,
): Promise<NeonBranch> {
  if (plan.branchId) {
    const data = await neonJson<{ branch: NeonBranch }>(
      fetchFn,
      apiBaseUrl,
      plan.apiKey,
      `/projects/${plan.projectId}/branches/${plan.branchId}`,
    );
    if (!data.branch?.id) {
      throw new Error(`Neon branch ${plan.branchId} not found`);
    }
    return data.branch;
  }

  if (plan.branchName) {
    const search = encodeURIComponent(plan.branchName);
    const data = await neonJson<NeonListBranchesResponse>(
      fetchFn,
      apiBaseUrl,
      plan.apiKey,
      `/projects/${plan.projectId}/branches?search=${search}`,
    );
    const exact = data.branches?.find(
      (branch) => branch.name === plan.branchName,
    );
    if (exact) return exact;
  }

  if (plan.endpointHost) {
    const data = await neonJson<NeonListEndpointsResponse>(
      fetchFn,
      apiBaseUrl,
      plan.apiKey,
      `/projects/${plan.projectId}/endpoints`,
    );
    const endpoint = data.endpoints?.find(
      (item) => item.host.toLowerCase() === plan.endpointHost,
    );
    if (endpoint?.branch_id) {
      const branchData = await neonJson<{ branch: NeonBranch }>(
        fetchFn,
        apiBaseUrl,
        plan.apiKey,
        `/projects/${plan.projectId}/branches/${endpoint.branch_id}`,
      );
      if (branchData.branch?.id) return branchData.branch;
    }
  }

  throw new Error(
    `Could not resolve Neon preview branch` +
      (plan.branchName ? ` (name=${plan.branchName})` : "") +
      (plan.endpointHost ? ` (host=${plan.endpointHost})` : ""),
  );
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
  } = options;

  const deadline = Date.now() + timeoutMs;

  for (const operation of operations) {
    let status = operation.status;
    while (status !== "finished" && status !== "skipped") {
      if (status === "failed" || status === "cancelled" || status === "error") {
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

  const branch = await resolveBranch(plan, fetchFn, apiBaseUrl);
  const parentBranchId = branch.parent_id?.trim();
  if (!parentBranchId) {
    throw new Error(
      `Neon branch ${branch.id} (${branch.name}) has no parent_id; cannot reset from parent`,
    );
  }

  const restore = await neonJson<NeonRestoreResponse>(
    fetchFn,
    apiBaseUrl,
    plan.apiKey,
    `/projects/${plan.projectId}/branches/${branch.id}/restore`,
    {
      method: "POST",
      body: JSON.stringify({ source_branch_id: parentBranchId }),
    },
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
    });
  }

  return {
    branchId: branch.id,
    branchName: branch.name,
    parentBranchId,
    operationIds: operations.map((operation) => operation.id),
  };
}
