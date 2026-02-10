/**
 * Get model image URLs for light and dark themes
 * @param modelId - The model identifier (e.g., "gpt-4o", "gpt4o", "gemini-2.0-flash")
 * @returns Object with light and dark image URLs, or null if no image is available
 */
export function getModelImageUrl(
  modelId: string,
): { light: string; dark: string } | null {
  // OpenAI models
  if (
    modelId === "gpt4" ||
    modelId === "gpt4o" ||
    modelId === "gpt-4o-mini" ||
    modelId === "gpt-4o"
  ) {
    return {
      light: "/images/models/openai-black.png",
      dark: "/images/models/openai-white.png",
    };
  }
  // Gemini models
  if (modelId.startsWith("gemini")) {
    return {
      light: "/images/models/gemini.png",
      dark: "/images/models/gemini.png",
    };
  }
  return null;
}
