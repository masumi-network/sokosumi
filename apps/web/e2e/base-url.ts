const ALLOWED_HOST =
  /^(localhost|127\.0\.0\.1|preprod\.sokosumi\.com|[a-z0-9-]+\.preview\.sokosumi\.com|[a-z0-9-]+\.vercel\.app)$/;

/** Explicit non-production target only: no default, production refused. */
export function resolveBaseUrl(env: Record<string, string | undefined>) {
  const raw = env.E2E_BASE_URL?.trim();
  if (!raw)
    throw new Error("E2E_BASE_URL is required (preview or preprod URL)");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E_BASE_URL is not a URL: ${raw}`);
  }
  if (!ALLOWED_HOST.test(url.hostname)) {
    throw new Error(
      `E2E_BASE_URL host is not an allowed non-production host: ${url.hostname}`,
    );
  }
  return url.origin;
}

/** A PR preview's Web host; its Core is the same deployment pair with `core` for `app`. */
const PR_PREVIEW_APP =
  /^sokosumi-app-(mainnet|preprod)-git-([a-z0-9-]+)\.preview\.sokosumi\.com$/;

/**
 * Core for a PR preview, for specs that write their own test data through the API. Only a PR
 * preview pairs, so no other target (preprod, local, a bare Vercel URL, production) gets writes.
 */
export function resolvePreviewCoreUrl(baseUrl: string) {
  const { protocol, hostname } = new URL(baseUrl);
  const match = PR_PREVIEW_APP.exec(hostname);
  if (protocol !== "https:" || !match) {
    throw new Error(
      `Writing test data through Core needs a PR preview (sokosumi-app-<network>-git-<branch>.preview.sokosumi.com), not ${hostname}`,
    );
  }
  return `https://sokosumi-core-${match[1]}-git-${match[2]}.preview.sokosumi.com`;
}
