/**
 * Background GET of a web route that mirrors a Core read (SOK-986). Outside
 * the server action queue; bounded; null on any failure, redirect, or
 * non-2xx so a late or failed read never replaces newer local data.
 */
export async function fetchBackgroundJson(
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok || response.redirected) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
