import {
  APICallError,
  EmptyResponseBodyError,
  InvalidPromptError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3StreamResult,
  type SharedV3Warning,
} from "@ai-sdk/provider";
import { getModelIdentifier } from "@sokosumi/chat";
import { parseSokosumiProviderOptions } from "./parse-provider-options.js";
import {
  buildResponsesApiWarnings,
  lastTurnToResponsesInput,
  promptToResponsesInput,
} from "./prompt/to-responses-input.js";
import {
  createResponsesSseToV3Stream,
  emptyUsage,
  finishStop,
} from "./stream/responses-sse-to-v3-stream.js";
import type { CreateSokosumiOptions } from "./types.js";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";

export type SokosumiLanguageModel = LanguageModelV3 & {
  readonly provider: "sokosumi";
};

function resolveModelIdForLanguageModel(modelId: string | null): string {
  if (typeof modelId === "string" && modelId.trim().length > 0) {
    return modelId;
  }
  return getModelIdentifier(null);
}

export function createSokosumiLanguageModel(
  modelId: string | null,
  config: CreateSokosumiOptions,
): SokosumiLanguageModel {
  const modelIdForLanguageModel = resolveModelIdForLanguageModel(modelId);
  async function doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const streamResult = await doStream(options);
    const reader = streamResult.stream.getReader();
    const content: LanguageModelV3Content[] = [];
    let textBuffer = "";
    let reasoningBuffer = "";
    let warnings: SharedV3Warning[] = [];
    let finishReason = finishStop();
    let usage = emptyUsage();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        switch (value.type) {
          case "stream-start":
            warnings = value.warnings;
            break;
          case "text-delta":
            textBuffer += value.delta;
            break;
          case "reasoning-start":
            reasoningBuffer = "";
            break;
          case "reasoning-delta":
            reasoningBuffer += value.delta;
            break;
          case "reasoning-end":
            if (reasoningBuffer.trim().length > 0) {
              content.push({
                type: "reasoning",
                text: reasoningBuffer,
              });
            }
            reasoningBuffer = "";
            break;
          case "finish":
            finishReason = value.finishReason;
            usage = value.usage;
            break;
          default:
            break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (textBuffer.trim().length > 0) {
      content.push({ type: "text", text: textBuffer });
    }

    return {
      content,
      finishReason,
      usage,
      warnings,
      request: streamResult.request,
      response: streamResult.response,
    };
  }

  async function doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const sokosumiOpts = parseSokosumiProviderOptions(
      options.providerOptions as Record<string, unknown> | undefined,
    );
    const promptWarnings = buildResponsesApiWarnings(options.prompt);

    if (sokosumiOpts.mode === "openrouter") {
      const responsesInput = promptToResponsesInput(options.prompt);
      if (responsesInput.length === 0) {
        throw new APICallError({
          message:
            "Sokosumi provider: prompt produced an empty Responses API input (no supported content to send).",
          url: OPENROUTER_RESPONSES_URL,
          requestBodyValues: { responsesInput },
          isRetryable: false,
        });
      }
      return streamOpenRouter(
        modelId,
        config,
        responsesInput,
        promptWarnings,
        sokosumiOpts,
        options,
      );
    }

    const coworkerWarnings = sokosumiOpts.imageGenerationModel
      ? [
          ...promptWarnings,
          {
            type: "compatibility" as const,
            feature: "openrouter:image_generation",
            details:
              "Image generation server tools are only forwarded in OpenRouter mode.",
          },
        ]
      : promptWarnings;

    return streamCoworker(coworkerWarnings, sokosumiOpts, options);
  }

  return {
    specificationVersion: "v3",
    provider: "sokosumi",
    modelId: modelIdForLanguageModel,
    supportedUrls: {},
    doGenerate,
    doStream,
  };
}

async function streamOpenRouter(
  modelId: string | null,
  config: CreateSokosumiOptions,
  responsesInput: ReturnType<typeof promptToResponsesInput>,
  promptWarnings: SharedV3Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  const apiKey = config.openRouterApiKey?.trim();
  if (!apiKey) {
    throw new InvalidPromptError({
      prompt: options.providerOptions,
      message:
        "Sokosumi provider: openRouterApiKey is missing from createSokosumi options but mode is openrouter.",
    });
  }

  const modelIdentifier = getModelIdentifier(modelId);
  const requestBody = {
    model: modelIdentifier,
    input: responsesInput,
    stream: true,
    max_output_tokens: config.openRouterMaxOutputTokens ?? 4096,
    ...(sokosumiOpts.imageGenerationModel
      ? {
          tools: [
            {
              type: "openrouter:image_generation",
              parameters: {
                model: sokosumiOpts.imageGenerationModel,
                quality: "high",
              },
            },
          ],
        }
      : {}),
  };

  const response = await fetch(OPENROUTER_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(config.openRouterHttpReferer
        ? { "HTTP-Referer": config.openRouterHttpReferer }
        : {}),
      ...(config.openRouterAppTitle
        ? { "X-Title": config.openRouterAppTitle }
        : {}),
      ...options.headers,
    },
    body: JSON.stringify(requestBody),
    signal: options.abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new APICallError({
      message: `OpenRouter Responses API error: ${response.status} ${errorText}`,
      url: OPENROUTER_RESPONSES_URL,
      requestBodyValues: requestBody,
      statusCode: response.status,
      responseBody: errorText,
      isRetryable: response.status >= 500,
    });
  }

  if (!response.body) {
    throw new EmptyResponseBodyError({
      message: "OpenRouter Responses API returned no body",
    });
  }

  return {
    stream: createResponsesSseToV3Stream(response.body, {
      warnings: promptWarnings,
      onResponseStarted: sokosumiOpts.onResponseStarted,
      onResponseCompleted: sokosumiOpts.onResponseCompleted,
    }),
    request: { body: requestBody },
    response: {
      headers: headersToRecord(response.headers),
    },
  };
}

async function streamCoworker(
  promptWarnings: SharedV3Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  const providerConvId = sokosumiOpts.providerConversationId!.trim();

  const fullResponsesInput = promptToResponsesInput(options.prompt);
  const responsesInput = lastTurnToResponsesInput(options.prompt);

  if (responsesInput.length === 0) {
    throw new APICallError({
      message:
        "Sokosumi provider: prompt produced an empty Responses API input (no supported content to send).",
      url: `${(sokosumiOpts.coworkerBaseUrl ?? "").replace(/\/$/, "")}/responses`,
      requestBodyValues: { responsesInput },
      isRetryable: false,
    });
  }

  const base = (sokosumiOpts.coworkerBaseUrl ?? "").replace(/\/$/, "");
  const url = `${base}/responses`;

  type CoworkerResponsesBody = {
    input: typeof fullResponsesInput;
    stream: boolean;
    conversation_id?: string;
  };

  function buildCoworkerResponsesBody(
    input: typeof fullResponsesInput,
    includeConversationId: boolean,
  ): CoworkerResponsesBody {
    const body: CoworkerResponsesBody = {
      input,
      stream: true,
    };
    if (includeConversationId) {
      body.conversation_id = providerConvId;
    }
    return body;
  }

  let body = buildCoworkerResponsesBody(responsesInput, true);

  let requestBodyForError: CoworkerResponsesBody = body;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sokosumi-User-Id": sokosumiOpts.sokosumiUserId ?? "",
    "X-Coworker-Slug": sokosumiOpts.coworkerSlug ?? "",
  };
  if (sokosumiOpts.sokosumiOrganizationId?.trim()) {
    headers["X-Sokosumi-Organization-Id"] =
      sokosumiOpts.sokosumiOrganizationId.trim();
  }
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      if (v !== undefined) {
        headers[k] = v;
      }
    }
  }

  let response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    const isInvalidConversationId =
      Boolean(body.conversation_id) &&
      (errorText.includes("invalid_conversation") ||
        errorText.includes("conversation not found") ||
        errorText.includes("invalid_conversation_id") ||
        errorText.includes("Unknown conversation"));

    if (isInvalidConversationId) {
      const notify = sokosumiOpts.onInvalidProviderConversationId;
      if (notify) {
        try {
          await Promise.resolve(notify());
        } catch (_error) {}
      }
      const retryBody = buildCoworkerResponsesBody(fullResponsesInput, false);
      body = retryBody;
      requestBodyForError = retryBody;
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(retryBody),
        signal: options.abortSignal,
      });
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new APICallError({
      message: `Coworker Responses API error: ${response.status} ${errorText}`,
      url,
      requestBodyValues: requestBodyForError,
      statusCode: response.status,
      responseBody: errorText,
      isRetryable: response.status >= 500,
    });
  }

  if (!response.body) {
    throw new EmptyResponseBodyError({
      message: "Coworker Responses API returned no body",
    });
  }

  return {
    stream: createResponsesSseToV3Stream(response.body, {
      warnings: promptWarnings,
      onResponseStarted: sokosumiOpts.onResponseStarted,
      onResponseCompleted: sokosumiOpts.onResponseCompleted,
    }),
    request: { body },
    response: {
      headers: headersToRecord(response.headers),
    },
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
