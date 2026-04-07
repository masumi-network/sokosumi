import { createSokosumi } from "@sokosumi/ai-provider";

import { getBetterAuthPublicBaseUrl } from "@/config/env";

type SokosumiProvider = ReturnType<typeof createSokosumi>;

let instance: SokosumiProvider | null = null;
let cachedOpenRouterApiKey: string | null = null;
let cachedOpenRouterHttpReferer: string | null = null;

export function getOpenRouterChatApiKeyForProvider(): string {
  return process.env.OPENROUTER_CHAT_API_KEY ?? "";
}

export function getSokosumiProvider(): SokosumiProvider {
  const openRouterApiKey = getOpenRouterChatApiKeyForProvider();
  const openRouterHttpReferer = getBetterAuthPublicBaseUrl();
  if (
    !instance ||
    cachedOpenRouterApiKey !== openRouterApiKey ||
    cachedOpenRouterHttpReferer !== openRouterHttpReferer
  ) {
    instance = createSokosumi({
      openRouterApiKey,
      openRouterHttpReferer,
      openRouterAppTitle: "Sokosumi",
    });
    cachedOpenRouterApiKey = openRouterApiKey;
    cachedOpenRouterHttpReferer = openRouterHttpReferer;
  }
  return instance;
}
