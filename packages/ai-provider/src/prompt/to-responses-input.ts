import {
  InvalidPromptError,
  type LanguageModelV4FilePart,
  type LanguageModelV4Prompt,
  type SharedV4FileData,
  type SharedV4Warning,
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

/**
 * LanguageModelV4 file parts use tagged `SharedV4FileData`. Also accept legacy
 * bare `Uint8Array | string | URL` at runtime for defensive compatibility.
 */
type FilePartData = SharedV4FileData | Uint8Array | string | URL;

type UnwrappedFileData = Uint8Array | string | URL;

export type OpenRouterResponsesInputMessage = {
  type: "message";
  role: string;
  content: Array<
    | OpenRouterResponsesInputTextItem
    | OpenRouterResponsesInputImageItem
    | OpenRouterResponsesInputFileItem
  >;
};

const MAPPED_USER_ASSISTANT_PART_TYPES = new Set(["text", "file"]);

export function buildResponsesApiWarnings(
  prompt: LanguageModelV4Prompt,
): SharedV4Warning[] {
  const warnings: SharedV4Warning[] = [];
  for (const message of prompt) {
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-result") {
          continue;
        }
        warnings.push({
          type: "unsupported",
          feature: `tool ${part.type} parts`,
          details:
            "Only tool-result parts on tool messages are forwarded to the Responses input; other tool parts are dropped.",
        });
      }
      continue;
    }

    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    for (const part of message.content) {
      if (!MAPPED_USER_ASSISTANT_PART_TYPES.has(part.type)) {
        warnings.push({
          type: "unsupported",
          feature: `${message.role} ${part.type} parts`,
          details:
            "Only text and file parts are forwarded to the Responses input; this part type is dropped.",
        });
        continue;
      }
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
      let url: string | null = null;
      try {
        url = toUrlString(unwrapFilePartData(part));
      } catch {
        // Unsupported tagged shapes (e.g. provider references) are errors at
        // map time; skip URL compatibility warnings here.
      }
      if (
        url !== null &&
        !url.startsWith("data:") &&
        !isWebUrl(url) &&
        !isImageMediaType(part.mediaType)
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

function dedupeWarnings(warnings: SharedV4Warning[]): SharedV4Warning[] {
  const seen = new Set<string>();
  const out: SharedV4Warning[] = [];
  for (const w of warnings) {
    const key =
      w.type === "other"
        ? `other:${w.message}`
        : w.type === "deprecated"
          ? `deprecated:${w.setting}:${w.message}`
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
    | Extract<LanguageModelV4Prompt[number], { role: "user" }>
    | Extract<LanguageModelV4Prompt[number], { role: "assistant" }>,
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
  message: Extract<LanguageModelV4Prompt[number], { role: "tool" }>,
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
  prompt: LanguageModelV4Prompt,
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
  part: LanguageModelV4FilePart,
): OpenRouterResponsesInputImageItem | OpenRouterResponsesInputFileItem {
  if (isImageMediaType(part.mediaType)) {
    return {
      type: "input_image",
      image_url: toImageUrl(part),
      detail: "auto",
    };
  }

  const data = unwrapFilePartData(part);
  const url = toUrlString(data);
  if (url !== null && !url.startsWith("data:")) {
    return {
      type: "input_file",
      file_url: url,
      filename: part.filename,
    };
  }

  return {
    type: "input_file",
    file_data: toResponsesInputFileData(part, data),
    filename: part.filename,
  };
}

function toImageUrl(part: LanguageModelV4FilePart): string {
  const data = unwrapFilePartData(part);
  const url = toUrlString(data);

  if (url !== null) {
    if (url.startsWith("data:") || isWebUrl(url)) {
      return url;
    }
    throw invalidFilePartError(
      part,
      "Image file parts only support http(s) URLs, data URLs, or raw bytes / base64 string payloads.",
    );
  }

  return toDataUrl(part, data);
}

/**
 * Inline `file_data` for OpenRouter/OpenAI Responses `input_file`.
 * Providers (e.g. Azure) expect PDFs and similar blobs as full data URLs
 * (`data:application/pdf;base64,...`), not raw base64 — see OpenRouter PDF docs
 * and OpenAI file-input guides.
 */
function toResponsesInputFileData(
  part: LanguageModelV4FilePart,
  data: UnwrappedFileData,
): string {
  if (data instanceof Uint8Array) {
    return `data:${part.mediaType};base64,${Buffer.from(data).toString("base64")}`;
  }

  if (data instanceof URL) {
    const url = data.toString();
    if (url.startsWith("data:")) {
      extractBase64DataFromDataUrl(url, part);
      return url;
    }
    throw invalidFilePartError(
      part,
      "URL-based file parts must be sent as file_url.",
    );
  }

  if (typeof data === "string") {
    if (isWebUrl(data)) {
      throw invalidFilePartError(
        part,
        "URL-based file parts must be sent as file_url.",
      );
    }
    if (data.startsWith("data:")) {
      extractBase64DataFromDataUrl(data, part);
      return data;
    }
    return `data:${part.mediaType};base64,${data}`;
  }

  throw invalidFilePartError(
    part,
    `Unsupported file data type "${typeof data}".`,
  );
}

function isTaggedFileData(value: unknown): value is SharedV4FileData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === "data" || type === "url" || type === "reference" || type === "text"
  );
}

/**
 * AI SDK 7 allows top-level media segments (`"image"`) as well as full IANA
 * types (`"image/png"`) and wildcards (`"image/*"`).
 */
function isImageMediaType(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  const slash = normalized.indexOf("/");
  const topLevel = slash === -1 ? normalized : normalized.slice(0, slash);
  return topLevel === "image";
}

/**
 * Unwrap LanguageModelV4 tagged file data (and legacy bare payloads) to
 * `Uint8Array | string | URL` for Responses API mapping.
 */
function unwrapFilePartData(part: LanguageModelV4FilePart): UnwrappedFileData {
  const data = part.data as FilePartData;

  if (!isTaggedFileData(data)) {
    return data;
  }

  switch (data.type) {
    case "url":
      return data.url;
    case "data":
      return data.data;
    case "text":
      return new TextEncoder().encode(data.text);
    case "reference":
      throw invalidFilePartError(
        part,
        "Provider file references are not supported; pass a URL or inline file data.",
      );
    default: {
      const _exhaustive: never = data;
      void _exhaustive;
      throw invalidFilePartError(part, "Unsupported tagged file data variant.");
    }
  }
}

function toUrlString(data: UnwrappedFileData): string | null {
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

function toDataUrl(
  part: LanguageModelV4FilePart,
  data: UnwrappedFileData,
): string {
  if (data instanceof Uint8Array) {
    return `data:${part.mediaType};base64,${Buffer.from(data).toString("base64")}`;
  }

  if (typeof data === "string") {
    if (data.startsWith("data:")) {
      return data;
    }
    if (isWebUrl(data)) {
      return data;
    }
    return `data:${part.mediaType};base64,${data}`;
  }

  if (data instanceof URL) {
    return data.toString();
  }

  throw invalidFilePartError(
    part,
    `Unsupported image data type "${typeof data}".`,
  );
}

function extractBase64DataFromDataUrl(
  value: string,
  part: LanguageModelV4FilePart,
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
  part: LanguageModelV4FilePart,
  reason: string,
): InvalidPromptError {
  return new InvalidPromptError({
    prompt: part,
    message: `Sokosumi provider: cannot map file part (${part.mediaType}) to Responses API input. ${reason}`,
  });
}

export function lastTurnToResponsesInput(
  prompt: LanguageModelV4Prompt,
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
