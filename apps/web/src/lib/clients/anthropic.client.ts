import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { InputSchemaType } from "@sokosumi/masumi/schemas";

import { getEnvSecrets } from "@/config/env.secrets";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export const anthropicClient = (() => {
  const anthropic = new Anthropic({
    apiKey: getEnvSecrets().ANTHROPIC_API_KEY,
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
        const message: Anthropic.Message = await anthropic.messages.create(
          {
            model: "claude-3-5-haiku-latest",
            max_tokens: 80,
            temperature: 0.9,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          },
          {
            maxRetries: 1,
            timeout: 4000,
          },
        );
        const textBlocks = message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text);

        if (textBlocks.length > 0) {
          return textBlocks[0];
        }
        return null;
      } catch (error) {
        console.error("Anthropic job name generation failed:", error);
        return null;
      }
    },

    async generateAgentSummary(description: string): Promise<string | null> {
      const systemPrompt = `Generate a descriptive agent summary following these rules:
        - Length: 90-110 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence, no agent name
        - Output: Summary only, no other text
      `;
      const userPrompt = `Agent Description: ${description}`;

      try {
        const message: Anthropic.Message = await anthropic.messages.create(
          {
            model: "claude-3-5-haiku-latest",
            max_tokens: 80,
            temperature: 0.9,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          },
          {
            maxRetries: 1,
            timeout: 4000,
          },
        );
        const textBlocks = message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text);

        if (textBlocks.length > 0) {
          return textBlocks[0];
        }
        return null;
      } catch (error) {
        console.error("Anthropic agent summary generation failed:", error);
        return null;
      }
    },
  };
})();
