/**
 * Vercel runs Core's crons on production deployments only, so nothing drives
 * `/sync/*` in local dev. This calls the given sync routes on an interval,
 * the way the cron would, against a Core started with `pnpm dev`.
 *
 *   pnpm --filter @sokosumi/core dev:crons                      # avatar state renders
 *   pnpm --filter @sokosumi/core dev:crons /sync/image-jobs     # any sync routes
 *
 * The avatar pool route is left out by default: its first run draws the whole
 * pool floor (paid images). Pass `/sync/soko-bot-avatars` to include it.
 *
 * Reads CRON_SECRET from apps/core/.env. CORE_URL (default http://localhost:8787)
 * and CRON_INTERVAL_SECONDS (default 20) override the target and the pace.
 */
const DEFAULT_PATHS = ["/sync/soko-bot-avatar-renders"];

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set; run with --env-file=.env");
  process.exit(1);
}
const base = process.env.CORE_URL ?? "http://localhost:8787";
const intervalMs = Number(process.env.CRON_INTERVAL_SECONDS ?? 20) * 1000;
const paths = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_PATHS;

async function tick(): Promise<void> {
  for (const path of paths) {
    const started = Date.now();
    try {
      const response = await fetch(new URL(path, base), {
        headers: { authorization: `Bearer ${secret}` },
      });
      console.info(`${path} ${response.status} in ${Date.now() - started} ms`);
    } catch (error) {
      console.warn(
        `${path} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

console.info(
  `Calling ${paths.join(", ")} on ${base} every ${intervalMs / 1000} s`,
);
for (;;) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
