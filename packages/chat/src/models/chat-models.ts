export interface ChatModel {
  id: string;
  name: string;
  iconProvider: string;
  openRouterId: string;
}

export const CHAT_MODELS = [
  {
    id: "minimax-m2-5",
    name: "MiniMax M2.5",
    iconProvider: "minimax",
    openRouterId: "minimax/minimax-m2.5",
  },
  {
    id: "kimi-k2-5",
    name: "Kimi K2.5",
    iconProvider: "moonshot",
    openRouterId: "moonshotai/kimi-k2.5",
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    iconProvider: "google",
    openRouterId: "google/gemini-3-flash-preview",
  },
  {
    id: "deepseek-v3-2",
    name: "DeepSeek V3.2",
    iconProvider: "deepseek",
    openRouterId: "deepseek/deepseek-v3.2",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    iconProvider: "anthropic",
    openRouterId: "anthropic/claude-opus-4.6",
  },
  {
    id: "grok-4-1-fast",
    name: "Grok 4.1 Fast",
    iconProvider: "xai",
    openRouterId: "x-ai/grok-4.1-fast",
  },
  {
    id: "gpt-5-2",
    name: "GPT-5.2",
    iconProvider: "openai",
    openRouterId: "openai/gpt-5.2",
  },
] as const satisfies ReadonlyArray<ChatModel>;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "gpt-5-2";

const CHAT_MODEL_MAP = new Map<string, string>(
  CHAT_MODELS.map((model) => [model.id, model.openRouterId]),
);

const CHAT_MODEL_BY_ID = new Map<string, ChatModel>(
  CHAT_MODELS.map((model) => [model.id, model]),
);

function getDefaultOpenRouterModelId(): string {
  const defaultModel = CHAT_MODELS.find(
    (model) => model.id === DEFAULT_CHAT_MODEL_ID,
  );

  return defaultModel?.openRouterId ?? "openai/gpt-5.2";
}

export function getModelIdentifier(modelId: string | null): string {
  if (!modelId) {
    return getDefaultOpenRouterModelId();
  }

  return CHAT_MODEL_MAP.get(modelId) ?? getDefaultOpenRouterModelId();
}

export function getChatModelById(
  modelId: string | null | undefined,
): ChatModel | null {
  if (!modelId) {
    return null;
  }

  return CHAT_MODEL_BY_ID.get(modelId) ?? null;
}
