import type { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Rendered per request so a visit runs the server function every page shares.
 * The cron in `vercel.json` hits it every five minutes: pages and API routes
 * are separate functions, and with no page traffic for a while the next
 * visitor waited for a cold start (about ten seconds on Home).
 */
export default async function HealthPage() {
  await connection();
  return <p>ok</p>;
}
