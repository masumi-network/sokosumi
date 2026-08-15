const PRODUCTION_BRANCH = "main";

/**
 * Prevent a Vercel CLI `--prod` deployment from promoting feature-branch
 * source into any Sokosumi project's Production environment.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkVercelProductionBranch(env) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") {
    return { ok: true };
  }

  const gitRef = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!gitRef) {
    return {
      ok: false,
      message:
        'Refusing Vercel Production build without VERCEL_GIT_COMMIT_REF. Production deployments must use "main".',
    };
  }

  if (gitRef !== PRODUCTION_BRANCH) {
    return {
      ok: false,
      message: `Refusing Vercel Production build from Git ref "${gitRef}". Production deployments must use "${PRODUCTION_BRANCH}".`,
    };
  }

  return { ok: true };
}

export function assertVercelProductionBranch(env = process.env) {
  const result = checkVercelProductionBranch(env);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

if (process.argv[1]?.endsWith("vercel-production-branch-guard.mjs")) {
  assertVercelProductionBranch();
}
