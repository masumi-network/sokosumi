import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { InputSchemaType } from "@sokosumi/masumi/schemas";
import { generateText } from "ai";

import { getEnvSecrets } from "@/config/env.secrets";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export const openrouterClient = (() => {
  const openrouter = createOpenRouter({
    apiKey: getEnvSecrets().OPENROUTER_DEFAULT_API_KEY,
  });

  return {
    async generateJobName(
      agent: AgentInfo,
      inputData: InputSchemaType,
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
          model: openrouter("anthropic/claude-haiku-4.5"),
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

    async generateTaskName(description: string): Promise<string | null> {
      const systemPrompt = `Generate a concise task name following these rules:
        - Length: 30-60 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence
        - Output: Name only, no other text
        - Do NOT: include end of sentence punctuation
      `;
      const userPrompt = `Task Description: ${description}`;

      try {
        const { text } = await generateText({
          model: openrouter("anthropic/claude-haiku-4.5"),
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.9,
          maxOutputTokens: 40,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter task name generation failed:", error);
        return null;
      }
    },

  };
})();
