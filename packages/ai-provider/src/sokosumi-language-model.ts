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
import { MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS } from "./coworker-agent-error.js";
import { parseSokosumiProviderOptions } from "./parse-provider-options.js";
import {
  buildResponsesApiWarnings,
  lastTurnToResponsesInput,
  promptToResponsesInput,
} from "./prompt/to-responses-input.js";
import { createCommitGateStream } from "./stream/commit-gate-stream.js";
import {
  createResponsesSseToV3Stream,
  emptyUsage,
  finishStop,
} from "./stream/responses-sse-to-v3-stream.js";
import type { CreateSokosumiOptions } from "./types.js";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";
const COWORKER_CONVERSATION_MAX_RETRIES = 2;
const SOKOSUMI_SUPPORTED_URL_PATTERNS: Record<string, RegExp[]> = {
  // The Responses API mapping forwards these as image_url/file_url or inline data.
  "*": [/^https?:\/\//i, /^data:/i],
};

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

    const coworkerWarnings = [
      ...promptWarnings,
      ...(sokosumiOpts.imageGenerationModel
        ? [
            {
              type: "compatibility" as const,
              feature: "openrouter:image_generation",
              details:
                "Image generation server tools are only forwarded in OpenRouter mode.",
            },
          ]
        : []),
      ...(sokosumiOpts.webSearchEnabled
        ? [
            {
              type: "compatibility" as const,
              feature: "openrouter:web_search",
              details:
                "Web search server tools are only forwarded in OpenRouter mode.",
            },
          ]
        : []),
    ];

    return streamCoworkerWithRetry(coworkerWarnings, sokosumiOpts, options);
  }

  return {
    specificationVersion: "v3",
    provider: "sokosumi",
    modelId: modelIdForLanguageModel,
    supportedUrls: SOKOSUMI_SUPPORTED_URL_PATTERNS,
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
  const tools: Array<Record<string, unknown>> = [];
  if (sokosumiOpts.webSearchEnabled) {
    tools.push({
      type: "openrouter:web_search",
      ...(sokosumiOpts.webSearchParameters
        ? { parameters: sokosumiOpts.webSearchParameters }
        : {}),
    });
  }
  if (sokosumiOpts.imageGenerationModel) {
    tools.push({
      type: "openrouter:image_generation",
      parameters: {
        model: sokosumiOpts.imageGenerationModel,
        quality: "high",
      },
    });
  }

  const requestBody = {
    model: modelIdentifier,
    input: responsesInput,
    stream: true,
    max_output_tokens: config.openRouterMaxOutputTokens ?? 4096,
    ...(tools.length > 0 ? { tools } : {}),
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
      stripReactImageGenerationEnvelope: Boolean(
        sokosumiOpts.imageGenerationModel,
      ),
    }),
    request: { body: requestBody },
    response: {
      headers: headersToRecord(response.headers),
    },
  };
}

async function streamCoworkerWithRetry(
  promptWarnings: SharedV3Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV3CallOptions,
  attempt = 0,
): Promise<LanguageModelV3StreamResult> {
  const inConversationMode = Boolean(
    sokosumiOpts.providerConversationId?.trim(),
  );
  const maxRetries = inConversationMode ? COWORKER_CONVERSATION_MAX_RETRIES : 0;
  const result = await streamCoworker(promptWarnings, sokosumiOpts, options);

  if (!inConversationMode || attempt >= maxRetries) {
    return result;
  }

  return {
    ...result,
    stream: createCommitGateStream(result.stream, {
      minGoodChars: MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
      onRetryNeeded: async () => {
        const nextAttempt = attempt + 1;
        if (nextAttempt > maxRetries) {
          return null;
        }
        const retryResult = await streamCoworkerWithRetry(
          promptWarnings,
          sokosumiOpts,
          options,
          nextAttempt,
        );
        return retryResult.stream;
      },
    }),
  };
}

async function streamCoworker(
  promptWarnings: SharedV3Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV3CallOptions,
): Promise<LanguageModelV3StreamResult> {
  const providerConvId = sokosumiOpts.providerConversationId?.trim() ?? null;
  const previousResponseId = sokosumiOpts.previousResponseId?.trim() ?? null;

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
    conversation?: string;
    previous_response_id?: string;
  };

  function buildCoworkerResponsesBody(
    input: typeof fullResponsesInput,
  ): CoworkerResponsesBody {
    const body: CoworkerResponsesBody = {
      input,
      stream: true,
    };
    if (providerConvId) {
      body.conversation = providerConvId;
      return body;
    }
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }
    return body;
  }

  function throwCoworkerResponsesApiError(
    res: Response,
    errorText: string,
    bodyForError: CoworkerResponsesBody,
  ): never {
    throw new APICallError({
      message: `Coworker Responses API error: ${res.status} ${errorText}`,
      url,
      requestBodyValues: bodyForError,
      statusCode: res.status,
      responseBody: errorText,
      isRetryable: res.status >= 500,
    });
  }

  let body = buildCoworkerResponsesBody(responsesInput);

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

  async function fetchCoworkerResponses(
    requestBody: CoworkerResponsesBody,
  ): Promise<Response> {
    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      const isInvalidConversationId =
        Boolean(requestBody.conversation) &&
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
        const retryBody: CoworkerResponsesBody = {
          input: fullResponsesInput,
          stream: true,
        };
        body = retryBody;
        requestBodyForError = retryBody;
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(retryBody),
          signal: options.abortSignal,
        });
      } else {
        throwCoworkerResponsesApiError(
          response,
          errorText,
          requestBodyForError,
        );
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throwCoworkerResponsesApiError(response, errorText, requestBodyForError);
    }

    return response;
  }

  const response = await fetchCoworkerResponses(body);

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
