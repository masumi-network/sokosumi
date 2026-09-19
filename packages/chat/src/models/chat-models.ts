const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-5.4";

export function getModelIdentifier(modelId: string | null): string {
  return modelId || DEFAULT_OPENROUTER_MODEL_ID;
}
