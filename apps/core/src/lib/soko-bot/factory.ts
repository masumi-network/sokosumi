import type { SokoBotRuntime } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { InMemorySokoBotRuntime } from "@/lib/soko-bot/in-memory-runtime";
import { InProcessSokoBotRuntime } from "@/lib/soko-bot/in-process-runtime";
import { SandboxSokoBotRuntime } from "@/lib/soko-bot/sandbox/sandbox-runtime";

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
    env.SOKO_BOT_RUNTIME_ADAPTER === "in-memory"
  ) {
    throw new Error(
      "SOKO_BOT_RUNTIME_ADAPTER must be sandbox or in-process when Soko Bot is enabled in a deployed environment",
    );
  }
  // Preview evaluation runs meter every model call through Core's ledger,
  // which only the in-process loop can do.
  const adapter = env.SOKO_BOT_EVALUATION_ALLOWANCE
    ? "in-process"
    : env.SOKO_BOT_RUNTIME_ADAPTER;
  runtime =
    adapter === "sandbox"
      ? new SandboxSokoBotRuntime()
      : adapter === "in-process"
        ? new InProcessSokoBotRuntime()
        : new InMemorySokoBotRuntime();
  return runtime;
}
