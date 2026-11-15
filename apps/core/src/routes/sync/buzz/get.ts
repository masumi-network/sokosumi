import { waitUntil } from "@vercel/functions";
import type { Hono } from "hono";

import { getEnv } from "@/config/env";
import { buzzConfig } from "@/services/buzz-bridge.service";
import {
  coreRequester,
  runLeasedBuzzBridge,
} from "@/services/buzz-bridge-runner";

import { authenticateCronSecret } from "../handler.js";

// Runs end well before the function's 300 s limit, leaving time for the
// change being applied to finish; the next minute's cron is already waiting
// for the lease, so the hand-over takes about a second.
const RUN_MS = 240_000;
const HANDOVER_WAIT_MS = 55_000;

function log(message: string, extra?: unknown) {
  if (extra === undefined) console.info(`[sync/buzz] ${message}`);
  else console.info(`[sync/buzz] ${message}`, extra);
}

export default function mount(app: Hono) {
  app.get("/buzz", (c) => {
    const unauthorized = authenticateCronSecret(c);
    if (unauthorized) return unauthorized;
    if (!buzzConfig()) return c.json({ message: "Buzz is not configured" });
    const until = Date.now() + RUN_MS;
    waitUntil(
      runLeasedBuzzBridge({
        core: coreRequester(getEnv().BETTER_AUTH_URL),
        log,
        until,
        waitMs: HANDOVER_WAIT_MS,
      }).then(
        (ran) => {
          if (!ran) log("another run holds the lease");
        },
        (error) => console.error("[sync/buzz] run failed", error),
      ),
    );
    return c.json({ message: "Buzz bridge started" });
  });
}
