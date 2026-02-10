import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { getEnv } from "@/config/env";
import { getModelIdentifier } from "@/helpers/model-mapping";

export type AgentInfo = {
  name: string;
  description?: string | null;
};

// OpenRouter Responses API event types
const RESPONSES_API_EVENTS = {
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  COMPLETED: "response.completed",
} as const;

// SSE stream markers
const SSE_DONE_MARKER = "[DONE]";
const SSE_DATA_PREFIX = "data: ";

// UIMessage stream event types
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

    /**
     * Stream chat response using OpenRouter Responses API
     * Converts Responses API format to UIMessage stream format for compatibility
     */
    async streamChatResponse(messages: unknown[], modelId: string | null) {
      const chatApiKey = getEnv().OPENROUTER_CHAT_API_KEY;
      if (!chatApiKey) {
        throw new Error("OpenRouter chat API key not configured");
      }

      const modelIdentifier = getModelIdentifier(modelId);
      // Transform messages to Responses API input format
      // Responses API uses 'input' field with structured message array format
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

      // Call OpenRouter Responses API directly
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
          "HTTP-Referer": process.env.BETTER_AUTH_URL || "",
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

      // Convert Responses API SSE stream to UIMessage stream format
      const stream = createUIMessageStream(response.body);

      // Return Response with proper headers for UIMessage stream
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

/**
 * Creates a ReadableStream that converts OpenRouter Responses API SSE format
 * to Vercel AI SDK UIMessage stream format
 */
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

  /**
   * Closes the stream with proper cleanup events
   */
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

  /**
   * Handles a text delta chunk from the Responses API
   */
  function handleTextDelta(
    delta: string,
    controller: ReadableStreamDefaultController,
  ) {
    if (streamClosed) return;

    // Send text-start event on first delta
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

    // Send text-delta event
    const deltaEvent = {
      type: UI_MESSAGE_EVENTS.TEXT_DELTA,
      delta,
      id: messageId,
    };
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
    );
  }

  /**
   * Processes a single SSE data line
   */
  function processSSELine(
    data: string,
    controller: ReadableStreamDefaultController,
  ): boolean {
    // Handle [DONE] marker
    if (data === SSE_DONE_MARKER) {
      closeStream(controller);
      return true; // Signal to stop processing
    }

    // Parse JSON chunk
    try {
      const chunk = JSON.parse(data) as { type: string; delta?: string };

      // Handle text delta events
      if (
        chunk.type === RESPONSES_API_EVENTS.OUTPUT_TEXT_DELTA &&
        chunk.delta &&
        typeof chunk.delta === "string"
      ) {
        handleTextDelta(chunk.delta, controller);
        return false; // Continue processing
      }

      // Handle completion event
      if (chunk.type === RESPONSES_API_EVENTS.COMPLETED) {
        closeStream(controller);
        return true; // Signal to stop processing
      }
    } catch (parseError) {
      // Skip invalid JSON chunks (non-fatal)
      console.warn("Failed to parse Responses API chunk:", parseError);
    }

    return false; // Continue processing
  }

  return new ReadableStream({
    async start(controller) {
      // Send initial start event
      const startEvent = { type: UI_MESSAGE_EVENTS.START };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`),
      );

      try {
        // Process stream chunks until done or closed
        while (!streamClosed) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode and buffer incoming data
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          // Process each complete line
          for (const line of lines) {
            // Skip SSE comments and empty lines
            if (!line.trim() || line.startsWith(":")) continue;

            // Process data lines
            if (line.startsWith(SSE_DATA_PREFIX)) {
              const data = line.slice(SSE_DATA_PREFIX.length);
              const shouldStop = processSSELine(data, controller);
              if (shouldStop) return;
            }
          }
        }

        // Ensure stream is properly closed if loop exits naturally
        if (!streamClosed) {
          closeStream(controller);
        }
      } catch (error) {
        // Handle errors gracefully
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
  });
}
