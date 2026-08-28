import type { SokoBotRuntime } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { InMemorySokoBotRuntime } from "@/lib/soko-bot/in-memory-runtime";
import { InProcessSokoBotRuntime } from "@/lib/soko-bot/in-process-runtime";

let runtime: SokoBotRuntime | null = null;

export function getSokoBotRuntime(): SokoBotRuntime {
  if (runtime) return runtime;
  const env = getEnv();
  const isDeployedEnvironment =
    process.env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview";
  if (
    isDeployedEnvironment &&
    env.SOKO_BOT_ENABLED &&
    env.SOKO_BOT_RUNTIME_ADAPTER !== "in-process"
  ) {
    throw new Error(
      "SOKO_BOT_RUNTIME_ADAPTER must be in-process when Soko Bot is enabled in a deployed environment",
    );
  }
  runtime =
    env.SOKO_BOT_RUNTIME_ADAPTER === "in-process"
      ? new InProcessSokoBotRuntime()
      : new InMemorySokoBotRuntime();
  return runtime;
}
