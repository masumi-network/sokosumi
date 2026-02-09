import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, streamText } from "ai";

import { getEnv } from "@/config/env";
import { getModelIdentifier } from "@/helpers/model-mapping";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export const openrouterClient = (() => {
  const defaultApiKey = getEnv().OPENROUTER_DEFAULT_API_KEY;
  const chatApiKey = getEnv().OPENROUTER_CHAT_API_KEY || defaultApiKey;

  const defaultOpenrouter = defaultApiKey
    ? createOpenRouter({ apiKey: defaultApiKey })
    : null;

  const chatOpenrouter = chatApiKey
    ? createOpenRouter({ apiKey: chatApiKey })
    : null;

  return {
    async generateJobName(
      agent: AgentInfo,
      inputData: Record<string, unknown>,
    ): Promise<string | null> {
      if (!defaultOpenrouter) {
        return null;
      }

      const inputSummary = Object.entries(inputData)
        .map(([key, value]) => `${key} => ${JSON.stringify(value)}`)
        .join(", ");

      const systemPrompt = `Generate a descriptive agent summary following these rules:
        - Length: 90-110 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence, no agent name
        - Output: Summary only, no other text
      `;
      const userPrompt = `Agent: ${agent.name} ${agent.description ? ` - ${agent.description}` : ""}\nInput: ${inputSummary}`;

      try {
        const { text } = await generateText({
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.9,
          maxOutputTokens: 80,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter job name generation failed:", error);
        return null;
      }
    },

    async streamChatResponse(messages: unknown[], modelId: string | null) {
      if (!chatOpenrouter) {
        throw new Error("OpenRouter chat API key not configured");
      }

      const modelIdentifier = getModelIdentifier(modelId);

      return streamText({
        model: chatOpenrouter(modelIdentifier),
        messages,
        maxOutputTokens: 4096,
      });
    },
  };
})();
