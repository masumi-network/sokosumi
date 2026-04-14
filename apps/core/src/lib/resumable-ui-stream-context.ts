import { waitUntil } from "@vercel/functions";
import { createResumableStreamContext } from "resumable-stream/ioredis";

type ResumableStreamContext = ReturnType<typeof createResumableStreamContext>;

let cachedContext: ResumableStreamContext | null = null;

export function isUiStreamResumptionConfigured(): boolean {
  return Boolean(
    process.env.REDIS_URL?.trim().length || process.env.KV_URL?.trim().length,
  );
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
