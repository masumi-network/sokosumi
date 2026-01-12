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
    apiKey: getEnvSecrets().OPENROUTER_API_KEY,
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
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter job name generation failed:", error);
        return null;
      }
    },

    async generateAgentSummary(description: string): Promise<string | null> {
      const systemPrompt = `You are a summary generator. Output ONLY the summary text—no questions, no explanations, no preamble.

        Task: Write a one-sentence agent summary (11-14 words maximum).
        
        Requirements:
        - Start with an action verb (Analyzes, Generates, Processes, Automates, etc.)
        - No agent name in output
        - Match input language
        - One sentence only
        
        Do NOT:
        - Ask clarifying questions
        - Add quotes around the output
        - Include any text besides the summary itself
        - Output phrases like "Unable to", "I cannot", "I'm sorry", or any refusal messages
      `;

      const userPrompt = `Agent Description: ${description}`;

      try {
        const { text } = await generateText({
          model: openrouter("anthropic/claude-haiku-4.5"),
          system: systemPrompt,
          prompt: userPrompt,
          temperature: 0.3,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter agent summary generation failed:", error);
        return null;
      }
    },
  };
})();
