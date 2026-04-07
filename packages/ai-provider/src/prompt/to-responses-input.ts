import type { LanguageModelV3Prompt, SharedV3Warning } from "@ai-sdk/provider";

export type OpenRouterResponsesInputMessage = {
  type: "message";
  role: string;
  content: Array<{ type: "input_text"; text: string }>;
};

export function buildResponsesApiWarnings(
  prompt: LanguageModelV3Prompt,
): SharedV3Warning[] {
  let sawUnsupportedFile = false;
  for (const message of prompt) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user" || message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "file") {
          sawUnsupportedFile = true;
          break;
        }
      }
    }
  }
  if (!sawUnsupportedFile) {
    return [];
  }
  return [
    {
      type: "unsupported",
      feature: "file parts",
      details:
        "File parts are omitted from the OpenRouter / coworker Responses input; only text is sent.",
    },
  ];
}

function userAssistantText(
  message:
    | Extract<LanguageModelV3Prompt[number], { role: "user" }>
    | Extract<LanguageModelV3Prompt[number], { role: "assistant" }>,
): string {
  let text = "";
  for (const part of message.content) {
    if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

function toolMessageText(
  message: Extract<LanguageModelV3Prompt[number], { role: "tool" }>,
): string {
  const lines: string[] = [];
  for (const part of message.content) {
    if (part.type === "tool-result") {
      lines.push(
        `Tool ${part.toolName} (${part.toolCallId}): ${JSON.stringify(part.output)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Maps an AI SDK V3 prompt to OpenRouter / OpenAI Responses `input` messages.
 */
export function promptToResponsesInput(
  prompt: LanguageModelV3Prompt,
): OpenRouterResponsesInputMessage[] {
  const input: OpenRouterResponsesInputMessage[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      const t = message.content.trim();
      if (t.length > 0) {
        input.push({
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: t }],
        });
      }
      continue;
    }

    if (message.role === "user") {
      const text = userAssistantText(message);
      if (text.trim().length > 0) {
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const text = userAssistantText(message);
      if (text.trim().length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "input_text", text }],
        });
      }
      continue;
    }

    if (message.role === "tool") {
      const text = toolMessageText(message);
      if (text.trim().length > 0) {
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        });
      }
    }
  }
  return input;
}
