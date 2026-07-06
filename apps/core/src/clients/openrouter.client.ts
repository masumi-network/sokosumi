import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { getEnv } from "@/config/env";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

interface OpenRouterRequestOptions {
  abortSignal?: AbortSignal;
}

// Best-effort name generation must not stall task/job creation: bound each
// request so a slow or hung OpenRouter call aborts and falls back to a
// non-LLM name instead of blocking the create request indefinitely.
const NAME_GENERATION_TIMEOUT_MS = 10_000;
const OPENROUTER_HAIKU_MODEL = "anthropic/claude-haiku-4.5";

interface GenerateOpenRouterTextOptions {
  instructions: string;
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  failureLogLabel: string;
}

async function generateOpenRouterText(
  openrouter: NonNullable<ReturnType<typeof createOpenRouter>>,
  options: GenerateOpenRouterTextOptions,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      ...(options.abortSignal !== undefined
        ? { abortSignal: options.abortSignal }
        : {}),
      model: openrouter(OPENROUTER_HAIKU_MODEL),
      instructions: options.instructions,
      prompt: options.prompt,
      temperature: options.temperature,
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    });

    return text || null;
  } catch (error) {
    console.error(`OpenRouter ${options.failureLogLabel} failed:`, error);
    return null;
  }
}

export const openrouterClient = (() => {
  const defaultApiKey = getEnv().OPENROUTER_DEFAULT_API_KEY;

  const defaultOpenrouter = defaultApiKey
    ? createOpenRouter({ apiKey: defaultApiKey })
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

      const instructions = `Generate a descriptive agent summary following these rules:
        - Length: 90-110 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence, no agent name
        - Output: Summary only, no other text
      `;
      const userPrompt = `Agent: ${agent.name} ${agent.description ? ` - ${agent.description}` : ""}\nInput: ${inputSummary}`;

      return generateOpenRouterText(defaultOpenrouter, {
        abortSignal: AbortSignal.timeout(NAME_GENERATION_TIMEOUT_MS),
        instructions,
        prompt: userPrompt,
        temperature: 0.9,
        maxOutputTokens: 80,
        failureLogLabel: "job name generation",
      });
    },

    async generateTaskName(description: string): Promise<string | null> {
      if (!defaultOpenrouter) {
        return null;
      }

      const instructions = `Generate a concise task name following these rules:
        - Length: 30-60 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single sentence
        - Output: Name only, no other text
        - Do NOT: include end of sentence punctuation
      `;
      const userPrompt = `Task Description: ${description}`;

      return generateOpenRouterText(defaultOpenrouter, {
        abortSignal: AbortSignal.timeout(NAME_GENERATION_TIMEOUT_MS),
        instructions,
        prompt: userPrompt,
        temperature: 0.9,
        maxOutputTokens: 40,
        failureLogLabel: "task name generation",
      });
    },

    async generateChatTitle(firstPrompt: string): Promise<string | null> {
      if (!defaultOpenrouter) {
        return null;
      }

      const trimmed = firstPrompt.trim().slice(0, 2000);
      if (!trimmed) {
        return null;
      }

      const instructions = `Generate a very short chat title from the user's first message. Rules:
        - Maximum 50 characters (including spaces and punctuation)
        - Language: Match the input
        - Format: Single phrase or sentence fragment, no quotes
        - Output: Title only, no other text
      `;
      const userPrompt = `First message: ${trimmed}`;

      const text = await generateOpenRouterText(defaultOpenrouter, {
        instructions,
        prompt: userPrompt,
        temperature: 0.5,
        maxOutputTokens: 40,
        failureLogLabel: "chat title generation",
      });

      if (!text) {
        return null;
      }

      const title = text.trim().slice(0, 50);
      return title || null;
    },

    async generateAgentSummary(
      description: string,
      options?: OpenRouterRequestOptions,
    ): Promise<string | null> {
      if (!defaultOpenrouter) {
        return null;
      }

      const instructions = `You are a summary generator. Output ONLY the summary text—no questions, no explanations, no preamble.

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

      return generateOpenRouterText(defaultOpenrouter, {
        abortSignal: options?.abortSignal,
        instructions,
        prompt: userPrompt,
        temperature: 0.3,
        failureLogLabel: "agent summary generation",
      });
    },
  };
})();
