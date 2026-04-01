import { createSokosumi } from "@sokosumi/ai-provider";

import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";

let instance: ReturnType<typeof createSokosumi> | null = null;

export function getSokosumiProvider(): ReturnType<typeof createSokosumi> {
  if (!instance) {
    const env = getEnv();
    instance = createSokosumi({
      openRouterApiKey: env.OPENROUTER_CHAT_API_KEY ?? "",
      openRouterHttpReferer: getBetterAuthPublicBaseUrl(),
      openRouterAppTitle: "Sokosumi",
    });
  }
  return instance;
}
