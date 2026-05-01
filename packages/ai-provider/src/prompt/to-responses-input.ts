import {
  InvalidPromptError,
  type LanguageModelV3FilePart,
  type LanguageModelV3Prompt,
  type SharedV3Warning,
} from "@ai-sdk/provider";

interface OpenRouterResponsesInputTextItem {
  type: "input_text";
  text: string;
}

interface OpenRouterResponsesInputImageItem {
  type: "input_image";
  image_url: string;
  detail: "auto";
}

interface OpenRouterResponsesInputFileItem {
  type: "input_file";
  file_data?: string;
  file_url?: string;
  filename?: string;
}

export type OpenRouterResponsesInputMessage = {
  type: "message";
  role: string;
  content: Array<
    | OpenRouterResponsesInputTextItem
    | OpenRouterResponsesInputImageItem
    | OpenRouterResponsesInputFileItem
  >;
};

export function buildResponsesApiWarnings(
  prompt: LanguageModelV3Prompt,
): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];
  for (const message of prompt) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    for (const part of message.content) {
      if (part.type !== "file") {
        continue;
      }
      if (message.role === "assistant") {
        warnings.push({
          type: "compatibility",
          feature: "assistant file parts",
          details:
            "File parts on assistant messages are forwarded to the Responses input. Confirm your model endpoint accepts multimodal assistant turns.",
        });
      }
      const url = toUrlString(part.data);
      if (
        url !== null &&
        !url.startsWith("data:") &&
        !isWebUrl(url) &&
        !part.mediaType.startsWith("image/")
      ) {
        warnings.push({
          type: "compatibility",
          feature: "non-HTTP(S) file URL",
          details: `A file part uses URL "${url.slice(0, 120)}${url.length > 120 ? "…" : ""}" as file_url. Only http(s) and data payloads are fully supported; other schemes may be rejected or mishandled by the upstream API.`,
        });
      }
    }
  }
  return dedupeWarnings(warnings);
}

function dedupeWarnings(warnings: SharedV3Warning[]): SharedV3Warning[] {
  const seen = new Set<string>();
  const out: SharedV3Warning[] = [];
  for (const w of warnings) {
    const key =
      w.type === "other"
        ? `other:${w.message}`
        : `${w.type}:${w.feature}:${w.details ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(w);
  }
  return out;
}

function userAssistantContent(
  message:
    | Extract<LanguageModelV3Prompt[number], { role: "user" }>
    | Extract<LanguageModelV3Prompt[number], { role: "assistant" }>,
): OpenRouterResponsesInputMessage["content"] {
  const content: OpenRouterResponsesInputMessage["content"] = [];
  let textRun = "";

  const flushTextRun = () => {
    if (textRun.trim().length > 0) {
      content.push({ type: "input_text", text: textRun });
    }
    textRun = "";
  };

  for (const part of message.content) {
    if (part.type === "text") {
      textRun += part.text;
      continue;
    }

    if (part.type === "file") {
      flushTextRun();
      content.push(filePartToResponsesContent(part));
    }
  }
  flushTextRun();

  return content;
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
      const content = userAssistantContent(message);
      if (content.length > 0) {
        input.push({
          type: "message",
          role: "user",
          content,
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      const content = userAssistantContent(message);
      if (content.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content,
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

function filePartToResponsesContent(
  part: LanguageModelV3FilePart,
): OpenRouterResponsesInputImageItem | OpenRouterResponsesInputFileItem {
  if (part.mediaType.startsWith("image/")) {
    return {
      type: "input_image",
      image_url: toImageUrl(part),
      detail: "auto",
    };
  }

  const url = toUrlString(part.data);
  if (url !== null && !url.startsWith("data:")) {
    return {
      type: "input_file",
      file_url: url,
      filename: part.filename,
    };
  }

  return {
    type: "input_file",
    file_data: toResponsesInputFileData(part),
    filename: part.filename,
  };
}

function toImageUrl(part: LanguageModelV3FilePart): string {
  const url = toUrlString(part.data);

  if (url !== null) {
    if (url.startsWith("data:") || isWebUrl(url)) {
      return url;
    }
    throw invalidFilePartError(
      part,
      "Image file parts only support http(s) URLs, data URLs, or raw bytes / base64 string payloads.",
    );
  }

  return toDataUrl(part);
}

/**
 * Inline `file_data` for OpenRouter/OpenAI Responses `input_file`.
 * Providers (e.g. Azure) expect PDFs and similar blobs as full data URLs
 * (`data:application/pdf;base64,...`), not raw base64 — see OpenRouter PDF docs
 * and OpenAI file-input guides.
 */
function toResponsesInputFileData(part: LanguageModelV3FilePart): string {
  if (part.data instanceof Uint8Array) {
    return `data:${part.mediaType};base64,${Buffer.from(part.data).toString("base64")}`;
  }

  if (part.data instanceof URL) {
    const url = part.data.toString();
    if (url.startsWith("data:")) {
      extractBase64DataFromDataUrl(url, part);
      return url;
    }
    throw invalidFilePartError(
      part,
      "URL-based file parts must be sent as file_url.",
    );
  }

  if (typeof part.data === "string") {
    if (isWebUrl(part.data)) {
      throw invalidFilePartError(
        part,
        "URL-based file parts must be sent as file_url.",
      );
    }
    if (part.data.startsWith("data:")) {
      extractBase64DataFromDataUrl(part.data, part);
      return part.data;
    }
    return `data:${part.mediaType};base64,${part.data}`;
  }

  throw invalidFilePartError(
    part,
    `Unsupported file data type "${typeof part.data}".`,
  );
}

function toUrlString(data: LanguageModelV3FilePart["data"]): string | null {
  if (data instanceof URL) {
    return data.toString();
  }

  if (typeof data !== "string") {
    return null;
  }

  try {
    return new URL(data).toString();
  } catch {
    return null;
  }
}

function isWebUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function toDataUrl(part: LanguageModelV3FilePart): string {
  if (part.data instanceof Uint8Array) {
    return `data:${part.mediaType};base64,${Buffer.from(part.data).toString("base64")}`;
  }

  if (typeof part.data === "string") {
    if (part.data.startsWith("data:")) {
      return part.data;
    }
    if (isWebUrl(part.data)) {
      return part.data;
    }
    return `data:${part.mediaType};base64,${part.data}`;
  }

  if (part.data instanceof URL) {
    return part.data.toString();
  }

  throw invalidFilePartError(
    part,
    `Unsupported image data type "${typeof part.data}".`,
  );
}

function extractBase64DataFromDataUrl(
  value: string,
  part: LanguageModelV3FilePart,
): string {
  // RFC 2397: mediatype may be empty (`data:;base64,...` is valid).
  const match = /^data:[^;,]*(?:;[^;,=]+=[^;,]+)*(;base64)?,(.*)$/i.exec(value);

  if (match?.[1] !== ";base64") {
    throw invalidFilePartError(
      part,
      "Only base64 data URLs are supported for file inputs.",
    );
  }

  return match[2] ?? "";
}

function invalidFilePartError(
  part: LanguageModelV3FilePart,
  reason: string,
): InvalidPromptError {
  return new InvalidPromptError({
    prompt: part,
    message: `Sokosumi provider: cannot map file part (${part.mediaType}) to Responses API input. ${reason}`,
  });
}

export function lastTurnToResponsesInput(
  prompt: LanguageModelV3Prompt,
): OpenRouterResponsesInputMessage[] {
  let start = -1;
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role === "user" || message.role === "system") {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return promptToResponsesInput(prompt);
  }
  return promptToResponsesInput(prompt.slice(start));
}
