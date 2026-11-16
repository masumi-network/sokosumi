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
