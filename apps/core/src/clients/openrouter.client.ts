import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { getEnv } from "@/config/env";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export const openrouterClient = (() => {
  const apiKey = getEnv().OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      async generateJobName(): Promise<string | null> {
        return null;
      },
    };
  }

  const openrouter = createOpenRouter({
    apiKey,
  });

  return {
    async generateJobName(
      agent: AgentInfo,
      inputData: Record<string, unknown>,
    ): Promise<string | null> {
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
          model: openrouter("anthropic/claude-4-5-haiku-latest"),
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.9,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter job name generation failed:", error);
        return null;
      }
    },
  };
})();
