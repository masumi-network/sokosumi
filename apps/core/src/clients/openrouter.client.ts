import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getModelIdentifier } from "@sokosumi/chat";
import { generateText } from "ai";

import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";

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

const RESPONSES_API_EVENTS = {
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  COMPLETED: "response.completed",
} as const;

const SSE_DONE_MARKER = "[DONE]";
const SSE_DATA_PREFIX = "data: ";

const UI_MESSAGE_EVENTS = {
  START: "start",
  TEXT_START: "text-start",
  TEXT_DELTA: "text-delta",
  TEXT_END: "text-end",
  FINISH: "finish",
  ERROR: "error",
} as const;

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

      try {
        const { text } = await generateText({
          abortSignal: AbortSignal.timeout(NAME_GENERATION_TIMEOUT_MS),
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          instructions,
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

      try {
        const { text } = await generateText({
          abortSignal: AbortSignal.timeout(NAME_GENERATION_TIMEOUT_MS),
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          instructions,
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

      try {
        const { text } = await generateText({
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          instructions,
          prompt: userPrompt,
          temperature: 0.5,
          maxOutputTokens: 40,
        });

        if (!text) return null;
        const title = text.trim().slice(0, 50);
        return title || null;
      } catch (error) {
        console.error("OpenRouter chat title generation failed:", error);
        return null;
      }
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

      try {
        const { text } = await generateText({
          abortSignal: options?.abortSignal,
          model: defaultOpenrouter("anthropic/claude-haiku-4.5"),
          instructions,
          prompt: userPrompt,
          temperature: 0.3,
        });

        return text || null;
      } catch (error) {
        console.error("OpenRouter agent summary generation failed:", error);
        return null;
      }
    },

    async streamChatResponse(messages: unknown[], modelId: string | null) {
      const chatApiKey = getEnv().OPENROUTER_CHAT_API_KEY;
      if (!chatApiKey) {
        throw new Error("OpenRouter chat API key not configured");
      }

      const modelIdentifier = getModelIdentifier(modelId);
      const responsesInput = messages.map((msg: unknown) => {
        const m = msg as { role: string; content: string };
        return {
          type: "message",
          role: m.role,
          content: [
            {
              type: "input_text",
              text: m.content,
            },
          ],
        };
      });

      const requestBody = {
        model: modelIdentifier,
        input: responsesInput,
        stream: true,
        max_output_tokens: 4096,
      };
      const response = await fetch("https://openrouter.ai/api/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chatApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": getBetterAuthPublicBaseUrl(),
          "X-Title": "Sokosumi",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `OpenRouter Responses API error: ${response.status} ${errorText}`,
        );
      }

      if (!response.body) {
        throw new Error("No response body from OpenRouter Responses API");
      }

      const stream = createUIMessageStream(response.body);

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    },
  };
})();

function createUIMessageStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const messageId = "response-message";

  let buffer = "";
  let textStarted = false;
  let streamClosed = false;
  let cancelled = false;

  function closeStream(controller: ReadableStreamDefaultController) {
    if (streamClosed) return;
    streamClosed = true;

    if (textStarted) {
      const endEvent = { type: UI_MESSAGE_EVENTS.TEXT_END, id: messageId };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(endEvent)}\n\n`),
      );
    }

    const finishEvent = { type: UI_MESSAGE_EVENTS.FINISH };
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(finishEvent)}\n\n`),
    );
    controller.enqueue(encoder.encode(`data: ${SSE_DONE_MARKER}\n\n`));
    controller.close();
  }

  function handleTextDelta(
    delta: string,
    controller: ReadableStreamDefaultController,
  ) {
    if (streamClosed) return;

    if (!textStarted) {
      const startEvent = {
        type: UI_MESSAGE_EVENTS.TEXT_START,
        id: messageId,
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
      );
      textStarted = true;
    }

    const deltaEvent = {
      type: UI_MESSAGE_EVENTS.TEXT_DELTA,
      delta,
      id: messageId,
    };
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
    );
  }

  function processSSELine(
    data: string,
    controller: ReadableStreamDefaultController,
  ): boolean {
    if (data === SSE_DONE_MARKER) {
      closeStream(controller);
      return true;
    }

    try {
      const chunk = JSON.parse(data) as { type: string; delta?: string };

      if (
        chunk.type === RESPONSES_API_EVENTS.OUTPUT_TEXT_DELTA &&
        chunk.delta &&
        typeof chunk.delta === "string"
      ) {
        handleTextDelta(chunk.delta, controller);
        return false;
      }

      if (chunk.type === RESPONSES_API_EVENTS.COMPLETED) {
        closeStream(controller);
        return true;
      }
    } catch (parseError) {
      console.warn("Failed to parse Responses API chunk:", parseError);
    }

    return false;
  }

  return new ReadableStream({
    async start(controller) {
      const startEvent = { type: UI_MESSAGE_EVENTS.START };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
      );

      try {
        while (!streamClosed) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim() || line.startsWith(":")) continue;

            if (line.startsWith(SSE_DATA_PREFIX)) {
              const data = line.slice(SSE_DATA_PREFIX.length);
              const shouldStop = processSSELine(data, controller);
              if (shouldStop) return;
            }
          }
        }

        if (!streamClosed) {
          closeStream(controller);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (!streamClosed) {
          streamClosed = true;
          const errorEvent = {
            type: UI_MESSAGE_EVENTS.ERROR,
            errorText: errorMessage,
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
          );
          controller.close();
        }

        throw error;
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}
