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
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    iconProvider: "anthropic",
    openRouterId: "anthropic/claude-opus-4.7",
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

const CHAT_MODEL_MAP = new Map<string, string>([
  ...CHAT_MODELS.map((model) => [model.id, model.openRouterId] as const),
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
