/**
 * Maps internal model IDs to OpenRouter model identifiers
 */
export function getModelIdentifier(modelId: string | null): string {
  if (!modelId) {
    return "openai/gpt-4o-mini"; // Default model
  }

  const modelMap: Record<string, string> = {
    // OpenAI models (top 2 newest)
    gpt4o: "openai/gpt-4o",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
    gpt4: "openai/gpt-4",
    "gpt-4": "openai/gpt-4",
    // Google models (top 2 newest)
    "gemini-2.0-flash": "google/gemini-2.0-flash-001",
    "gemini-2.5-pro": "google/gemini-2.5-pro",
    // MistralAI models (top 2 newest)
    "mixtral-8x22b": "mistralai/mixtral-8x22b-instruct",
    "mixtral-8x7b": "mistralai/mixtral-8x7b-instruct",
  };

  return modelMap[modelId] || "openai/gpt-4o-mini";
}
