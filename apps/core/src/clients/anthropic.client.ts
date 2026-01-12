import Anthropic from "@anthropic-ai/sdk";

import { getEnv } from "@/config/env";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export const anthropicClient = (() => {
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      async generateJobName(): Promise<string | null> {
        return null;
      },
    };
  }

  const anthropic = new Anthropic({
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
  };
})();
