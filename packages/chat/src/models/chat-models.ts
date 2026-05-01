/** Input kinds the model accepts on OpenRouter (chat). */
export type ChatInputModality = "text" | "image";

export interface ChatModel {
  id: string;
  name: string;
  iconProvider: string;
  openRouterId: string;
  inputModalities: readonly ChatInputModality[];
  /** OpenRouter slug used by the openrouter:image_generation server tool. */
  imageGenerationOpenRouterId?: string;
}

export const CHAT_MODELS = [
  {
    id: "mimo-v2-5-pro",
    name: "MiMo V2.5 Pro",
    iconProvider: "xiaomi",
    openRouterId: "xiaomi/mimo-v2.5-pro",
    inputModalities: ["text"] as const,
  },
  {
    id: "kimi-k2-6",
    name: "Kimi K2.6",
    iconProvider: "moonshot",
    openRouterId: "moonshotai/kimi-k2.6",
    inputModalities: ["text", "image"] as const,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    iconProvider: "google",
    openRouterId: "google/gemini-3-flash-preview",
    inputModalities: ["text", "image"] as const,
    imageGenerationOpenRouterId: "google/gemini-3.1-flash-image-preview",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    iconProvider: "deepseek",
    openRouterId: "deepseek/deepseek-v4-pro",
    inputModalities: ["text"] as const,
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    iconProvider: "anthropic",
    openRouterId: "anthropic/claude-opus-4.7",
    inputModalities: ["text", "image"] as const,
  },
  {
    id: "grok-4-1-fast",
    name: "Grok 4.1 Fast",
    iconProvider: "xai",
    openRouterId: "x-ai/grok-4.1-fast",
    inputModalities: ["text", "image"] as const,
  },
  {
    id: "gpt-5-4",
    name: "GPT-5.4",
    iconProvider: "openai",
    openRouterId: "openai/gpt-5.4",
    inputModalities: ["text", "image"] as const,
    imageGenerationOpenRouterId: "openai/gpt-5.4-image-2",
  },
] as const satisfies ReadonlyArray<ChatModel>;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "gpt-5-4";

const CHAT_MODEL_MAP = new Map<string, string>([
  ...CHAT_MODELS.map((model) => [model.id, model.openRouterId] as const),
  // Keep persisted selections working after model upgrades.
  ["kimi-k2-5", "moonshotai/kimi-k2.6"],
  ["deepseek-v3-2", "deepseek/deepseek-v4-pro"],
  ["gpt-5-2", "openai/gpt-5.4"],
  // Keep persisted Opus 4.6 selections working after the model upgrade.
  ["claude-opus-4-6", "anthropic/claude-opus-4.7"],
  ["gpt4o", "openai/gpt-4o"],
  ["gpt-4o", "openai/gpt-4o"],
  ["gpt-4o-mini", "openai/gpt-4o-mini"],
  ["gpt-4", "openai/gpt-4"],
  ["gemini-2.0-flash", "google/gemini-2.0-flash-001"],
  ["gemini-2.5-pro", "google/gemini-2.5-pro"],
  ["mixtral-8x22b", "mistralai/mixtral-8x22b-instruct"],
  ["mixtral-8x7b", "mistralai/mixtral-8x7b-instruct"],
]);

function modalitiesIncludeImage(
  modalities: readonly ChatInputModality[],
): boolean {
  for (const modality of modalities) {
    if (modality === "image") {
      return true;
    }
  }

  return false;
}

/** Legacy OpenRouter slugs not listed in {@link CHAT_MODELS}. */
const LEGACY_OPENROUTER_IMAGE_INPUT = new Map<string, boolean>([
  ["openai/gpt-4o", true],
  ["openai/gpt-4o-mini", true],
  ["openai/gpt-4", false],
  ["google/gemini-2.0-flash-001", true],
  ["google/gemini-2.5-pro", true],
  ["mistralai/mixtral-8x22b-instruct", false],
  ["mistralai/mixtral-8x7b-instruct", false],
]);

export function chatModelSupportsImageInput(modelId: string | null): boolean {
  const effectiveId = modelId ?? DEFAULT_CHAT_MODEL_ID;
  const fromCatalog = CHAT_MODELS.find((m) => m.id === effectiveId);
  if (fromCatalog) {
    return modalitiesIncludeImage(fromCatalog.inputModalities);
  }

  const openRouterSlug = CHAT_MODEL_MAP.get(effectiveId);
  if (!openRouterSlug) {
    return chatModelSupportsImageInput(null);
  }

  const upgraded = CHAT_MODELS.find((m) => m.openRouterId === openRouterSlug);
  if (upgraded) {
    return modalitiesIncludeImage(upgraded.inputModalities);
  }

  return LEGACY_OPENROUTER_IMAGE_INPUT.get(openRouterSlug) ?? false;
}

function findCurrentCatalogModel(modelId: string | null): ChatModel | null {
  const effectiveId = modelId ?? DEFAULT_CHAT_MODEL_ID;
  const fromCatalog = CHAT_MODELS.find((model) => model.id === effectiveId);
  if (fromCatalog) {
    return fromCatalog;
  }

  const openRouterSlug = CHAT_MODEL_MAP.get(effectiveId);
  if (!openRouterSlug) {
    return null;
  }

  return (
    CHAT_MODELS.find((model) => model.openRouterId === openRouterSlug) ?? null
  );
}

export function getChatModelImageGenerationOpenRouterId(
  modelId: string | null,
): string | null {
  return findCurrentCatalogModel(modelId)?.imageGenerationOpenRouterId ?? null;
}

export function chatModelSupportsImageGeneration(
  modelId: string | null,
): boolean {
  return getChatModelImageGenerationOpenRouterId(modelId) !== null;
}

function getDefaultOpenRouterModelId(): string {
  const defaultModel = CHAT_MODELS.find(
    (model) => model.id === DEFAULT_CHAT_MODEL_ID,
  );

  return defaultModel?.openRouterId ?? "openai/gpt-5.4";
}

export function getModelIdentifier(modelId: string | null): string {
  if (!modelId) {
    return getDefaultOpenRouterModelId();
  }

  return CHAT_MODEL_MAP.get(modelId) ?? getDefaultOpenRouterModelId();
}
