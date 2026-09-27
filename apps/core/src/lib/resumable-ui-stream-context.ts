import { waitUntil } from "@vercel/functions";
import { createResumableStreamContext } from "resumable-stream/ioredis";

import { getRedisUrl } from "@/lib/redis";

type ResumableStreamContext = ReturnType<typeof createResumableStreamContext>;

let cachedContext: ResumableStreamContext | null = null;

export function isUiStreamResumptionConfigured(): boolean {
  return getRedisUrl() !== null;
}

export function getResumableUiStreamContext(): ResumableStreamContext {
  if (!isUiStreamResumptionConfigured()) {
    throw new Error("REDIS_URL or KV_URL is required for resumable UI streams");
  }
  if (!cachedContext) {
    cachedContext = createResumableStreamContext({
      waitUntil: (promise: Promise<unknown>) => {
        waitUntil(promise);
      },
      keyPrefix: "sokosumi-ui-chat",
    });
  }
  return cachedContext;
}
