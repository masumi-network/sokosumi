import Anthropic from "@anthropic-ai/sdk";

import { getEnvSecrets } from "@/config/env.secrets";

const anthropic = new Anthropic({ apiKey: getEnvSecrets().ANTHROPIC_API_KEY });

export type AgentInfo = {
  name: string;
  description?: string | null;
};

export async function generateJobName(
  agent: AgentInfo,
  inputData: Map<string, unknown>,
): Promise<string | null> {
  const inputSummary = Array.from(inputData.entries())
    .map(([key, value]) => `${key} => ${JSON.stringify(value)}`)
    .join(", ");

  const systemPrompt =
    "You are an assistant that generates concise, descriptive job titles. The title should not exceed 80 characters and must be in the same language as the input data. The input data takes precedence over the agent name and description. Aim to create unique titles based on the input data. Please respond with only the title, without any additional text. Do not repeat the agent name in your response.";
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
}
