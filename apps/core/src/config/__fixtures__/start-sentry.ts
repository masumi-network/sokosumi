// Run in a fresh process so the real SDK starts without a client.
import { close, flush } from "@sentry/node";
import { getEnv } from "@/config/env";
import { initSentry } from "@/lib/sentry";

// A route can read configuration during import, before the entry point runs.
getEnv();
getEnv();
initSentry();
if (!(await flush(5000))) throw new Error("First Sentry flush timed out");
initSentry();
if (!(await close(5000))) throw new Error("Second Sentry flush timed out");
