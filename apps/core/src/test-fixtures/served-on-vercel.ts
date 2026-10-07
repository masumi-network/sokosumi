/**
 * Vercel terminates TLS before the function, and `@hono/node-server` reads the
 * scheme off the socket, so Core receives every request as plain HTTP.
 */
export function asServedOnVercel(url: string): string {
  return url.replace(/^https:/, "http:");
}
