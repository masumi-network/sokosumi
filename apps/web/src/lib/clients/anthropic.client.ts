import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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
      inputData: Map<string, unknown>,
    ): Promise<string | null> {
      const inputSummary = Array.from(inputData.entries())
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
      const systemPrompt =
        "You are an assistant that generates simple, descriptive agent summary. The summary must be less than 120 characters and should be longer than 100 characters and must be in the same language as the input data. The input data is the agent description, which explains what the agent does in detail. Please respond with only the summary, without any additional text. Do not repeat the agent name in your response.";
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
