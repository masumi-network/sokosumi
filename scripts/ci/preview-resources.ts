import {
  assertPreviewBranchResettable,
  createBranch,
  deleteBranch,
  findBranchByName,
  getBranchConnectionUrls,
  listBranches,
  neonErrorReason,
  refreshBranchExpiration,
  waitForOperations,
} from "../cloud-agent-db/neon-api.mjs";

export const NEON_API_KEY_VARIABLE = "NEON_API_KEY";
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface PreviewIdentity {
  repoId: number;
  pullNumber: number;
}

export interface PreviewOptions extends PreviewIdentity {
  ref: string;
  neonEnv?: NodeJS.ProcessEnv;
  neonFetchImpl?: typeof fetch;
  fetchImpl?: typeof fetch;
  vercelToken: string;
  teamId: string;
}

interface Target {
  network: string;
  app: string;
  projectId: string;
}

export function projectIdVariable(network: string) {
  return `NEON_PREVIEW_PROJECT_ID_${network.toUpperCase()}`;
}

export function readPreviewNeonConfigs(
  env: NodeJS.ProcessEnv,
  networks: string[],
) {
  function required(variable: string) {
    const value = env[variable]?.trim();
    if (!value) throw new Error(`${variable} is not set`);
    return value;
  }
  return networks.map((network) => ({
    network,
    config: {
      apiKey: required(NEON_API_KEY_VARIABLE),
      projectId: required(projectIdVariable(network)),
    },
  }));
}

export function previewBranchName({ repoId, pullNumber }: PreviewIdentity) {
  if (
    !Number.isSafeInteger(repoId) ||
    repoId <= 0 ||
    !Number.isSafeInteger(pullNumber) ||
    pullNumber <= 0
  ) {
    throw new Error(
      "A repository id and PR number are required for preview ownership",
    );
  }
  return `preview/gh-${repoId}-pr-${pullNumber}`;
}

export function previewMetadata(identity: PreviewIdentity) {
  previewBranchName(identity);
  return {
    sokosumiPreviewRepo: String(identity.repoId),
    sokosumiPreviewPr: String(identity.pullNumber),
  };
}

function envComment(identity: PreviewIdentity) {
  return `GitHub-managed ${previewBranchName(identity)}`;
}

export function previewNeonConfigs(
  options: Pick<PreviewOptions, "neonEnv" | "neonFetchImpl">,
  networks: string[],
) {
  return readPreviewNeonConfigs(options.neonEnv ?? process.env, networks).map(
    ({ network, config }) => ({
      network,
      config: {
        ...config,
        fetchImpl: (url: string | URL | Request, init?: RequestInit) =>
          (options.neonFetchImpl ?? fetch)(url, {
            ...init,
            signal: AbortSignal.timeout(30_000),
          }),
      },
    }),
  );
}

// Error responses can echo submitted environment values. Never log their bodies.
export async function vercelRequest(
  options: Pick<PreviewOptions, "fetchImpl" | "vercelToken" | "teamId">,
  pathname: string,
  init: RequestInit = {},
) {
  const url = new URL(pathname, "https://api.vercel.com");
  url.searchParams.set("teamId", options.teamId);
  const response = await (options.fetchImpl ?? fetch)(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${options.vercelToken}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 404 && init.method === "DELETE") return null;
  if (!response.ok)
    throw new Error(
      `Vercel ${init.method ?? "GET"} ${url.pathname} failed (${response.status})`,
    );
  return response.status === 204 ? null : response.json();
}

async function projectEnvs(options: PreviewOptions, projectId: string) {
  const result = await vercelRequest(options, `/v10/projects/${projectId}/env`);
  if (!Array.isArray(result?.envs))
    throw new Error("Vercel environment list is missing");
  return result.envs;
}

// Neon errors name the project and branch. Callers paste this onto a public PR.
function publicError(error: unknown) {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    "detail" in error
  ) {
    return Object.assign(new Error(neonErrorReason(error)), {
      status: error.status,
    });
  }
  return error;
}

export async function preparePreviewResources(
  options: PreviewOptions,
  targets: Target[],
) {
  try {
    await provisionPreviewResources(options, targets);
  } catch (error) {
    throw publicError(error);
  }
}

async function provisionPreviewResources(
  options: PreviewOptions,
  targets: Target[],
) {
  const cores = targets.filter((target) => target.app === "core");
  const configs = previewNeonConfigs(
    options,
    cores.map((target) => target.network),
  );
  const name = previewBranchName(options);
  // Validate every project before creating a branch. The integration must stop
  // owning preview credentials before Actions takes over; production is untouched.
  for (const core of cores) {
    const envs = await projectEnvs(options, core.projectId);
    for (const env of envs) {
      if (!env.target?.includes("preview")) continue;
      if (
        /^(DATABASE_URL|POSTGRES_)/.test(env.key) &&
        env.configurationId &&
        (!env.gitBranch || env.gitBranch === options.ref)
      ) {
        throw new Error(
          "Disable the Neon integration for Preview before using GitHub-managed previews; keep Production connected",
        );
      }
      if (
        ["DATABASE_URL", "DATABASE_URL_UNPOOLED"].includes(env.key) &&
        env.gitBranch === options.ref &&
        env.comment !== envComment(options)
      ) {
        throw new Error(
          "Preview database environment variables are owned by another workflow; resolve them before deploying",
        );
      }
    }
  }
  for (const { network, config } of configs) {
    const core = cores.find((target) => target.network === network);
    if (!core) throw new Error("Core preview target is missing");
    const parent = (await listBranches(config)).find(
      (branch) => branch.default === true,
    );
    if (
      !parent ||
      parent.name.startsWith("preview/") ||
      parent.name.startsWith("cloud-agent-")
    ) {
      throw new Error(`No production parent in the ${network} Neon project`);
    }
    // Child branches copy the parent's role passwords unless the parent is protected.
    if (parent.protected !== true) {
      throw new Error(
        `The ${network} Neon parent "${parent.name}" must be protected so preview branches do not reuse its role passwords`,
      );
    }
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    let branch = await findBranchByName(config, name);
    if (!branch) {
      try {
        const created = await createBranch(config, {
          name,
          parentId: parent.id,
          expiresAt,
        });
        branch = created?.branch ?? null;
        await waitForOperations(config, created?.operations ?? []);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 409
        )
          throw error;
        branch = await findBranchByName(config, name);
      }
    }
    if (!branch?.id || branch.name !== name)
      throw new Error("Neon preview branch is missing");
    assertPreviewBranchResettable(branch);
    if (branch.parent_id !== parent.id)
      throw new Error("Preview branch has an unexpected parent");
    await refreshBranchExpiration(config, branch.id, { expiresAt });
    const urls = await getBranchConnectionUrls(config, branch.id);
    const values = {
      DATABASE_URL: urls.databaseUrl,
      DATABASE_URL_UNPOOLED: urls.databaseUrlUnpooled,
    };
    for (const [key, value] of Object.entries(values)) {
      const result = await vercelRequest(
        options,
        `/v10/projects/${core.projectId}/env?upsert=true`,
        {
          method: "POST",
          body: JSON.stringify({
            key,
            value,
            type: "encrypted",
            target: ["preview"],
            gitBranch: options.ref,
            comment: envComment(options),
          }),
        },
      );
      if (result?.error || result?.failed?.length)
        throw new Error(
          "Vercel rejected preview database environment variables",
        );
    }
  }
}

export async function cleanupPreviewResources(
  options: PreviewOptions,
  targets: Target[],
) {
  const name = previewBranchName(options);
  const metadata = previewMetadata(options);
  // Inventory first: no deletion while pagination or ownership checks can fail.
  const deployments: string[] = [];
  for (const target of targets) {
    let until: number | undefined;
    do {
      const query = new URLSearchParams({
        projectId: target.projectId,
        target: "preview",
        limit: "100",
      });
      if (until !== undefined) query.set("until", String(until));
      const page = await vercelRequest(options, `/v7/deployments?${query}`);
      if (!Array.isArray(page?.deployments))
        throw new Error("Vercel deployment list is missing");
      for (const deployment of page.deployments) {
        if (deployment.target === "production") continue;
        if (
          deployment.meta?.sokosumiPreviewRepo ===
            metadata.sokosumiPreviewRepo &&
          deployment.meta?.sokosumiPreviewPr === metadata.sokosumiPreviewPr
        ) {
          deployments.push(deployment.uid);
        }
      }
      const next = page.pagination?.next;
      if (next != null && until !== undefined && next >= until)
        throw new Error("Vercel pagination did not advance");
      until = next ?? undefined;
    } while (until !== undefined);
  }
  const branches = [];
  for (const { config } of previewNeonConfigs(options, [
    "mainnet",
    "preprod",
  ])) {
    const branch = await findBranchByName(config, name);
    if (branch) {
      assertPreviewBranchResettable(branch);
      branches.push({ config, branch });
    }
  }
  // Removing deployments first prevents remaining previews from using a deleted DB.
  for (const id of deployments) {
    if (!id) throw new Error("Vercel deployment id is missing");
    await vercelRequest(options, `/v13/deployments/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  for (const target of targets.filter((target) => target.app === "core")) {
    for (const env of await projectEnvs(options, target.projectId)) {
      // Comment is the ownership mark. gitBranch is not: a rename leaves the old name.
      if (
        env.comment === envComment(options) &&
        env.target?.length === 1 &&
        env.target[0] === "preview" &&
        !env.configurationId &&
        ["DATABASE_URL", "DATABASE_URL_UNPOOLED"].includes(env.key)
      ) {
        await vercelRequest(
          options,
          `/v9/projects/${target.projectId}/env/${encodeURIComponent(env.id)}`,
          { method: "DELETE" },
        );
      }
    }
  }
  for (const { config, branch } of branches) {
    try {
      const result = await deleteBranch(config, branch.id);
      await waitForOperations(config, result?.operations ?? []);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        error.status !== 404
      )
        throw error;
    }
  }
  return {
    kind: "cleanup",
    deployments: deployments.length,
    branches: branches.length,
  };
}
