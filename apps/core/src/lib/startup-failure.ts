import { Worker } from "node:worker_threads";
import { createError } from "evlog";

import { type CoreError, createCoreLogger } from "./evlog.js";

/** How long a failing start waits for Sentry before it exits anyway. */
const SENTRY_DELIVERY_LIMIT_MS = 2_000;

/**
 * Sends one event to Sentry from a worker and blocks until it is sent or
 * {@link SENTRY_DELIVERY_LIMIT_MS} passes. A start that fails validation runs
 * synchronously, often while modules load, and exits right after: the drain's
 * own request is asynchronous and never gets a turn. Reads only `SENTRY_*`
 * from `process.env`, as `createSentryDrain()` does, because the validated
 * environment is the thing that failed.
 */
function deliverToSentryBeforeExit(event: Record<string, unknown>): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const { workerData } = require("node:worker_threads");
     import(workerData.sentry)
       .then((sentry) => sentry.sendToSentry(workerData.event, workerData.config))
       .catch(() => undefined)
       .then(() => {
         Atomics.store(workerData.signal, 0, 1);
         Atomics.notify(workerData.signal, 0);
       });`,
    {
      eval: true,
      workerData: {
        sentry: import.meta.resolve("evlog/sentry"),
        event,
        signal,
        config: {
          dsn,
          environment: process.env.SENTRY_ENVIRONMENT,
          release: process.env.SENTRY_RELEASE,
          timeout: SENTRY_DELIVERY_LIMIT_MS,
          retries: 0,
        },
      },
    },
  );
  worker.unref();
  Atomics.wait(signal, 0, 0, SENTRY_DELIVERY_LIMIT_MS);
}

/**
 * Core cannot start: one standalone error event, on stdout and in Sentry,
 * then `process.exit(code)`. For the startup checks in `config/env.ts`.
 */
export function failStartup(
  context: Record<string, unknown>,
  error: Omit<CoreError, "cause">,
  fields?: Record<string, unknown>,
  code = 1,
): never {
  const log = createCoreLogger(context);
  log.error(createError(error), fields);
  const event = log.emit();
  if (event) deliverToSentryBeforeExit(event);
  return process.exit(code);
}
