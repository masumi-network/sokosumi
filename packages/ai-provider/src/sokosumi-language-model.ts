import {
  APICallError,
  EmptyResponseBodyError,
  InvalidPromptError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamResult,
  type SharedV4Warning,
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
  createResponsesSseToV4Stream,
  emptyUsage,
  finishStop,
} from "./stream/responses-sse-to-v4-stream.js";
import type { CreateSokosumiOptions } from "./types.js";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";
const COWORKER_CONVERSATION_MAX_RETRIES = 2;
/**
 * Redirect hops followed on a coworker Responses POST. Each hop is re-validated
 * against the caller's SSRF guard, so this only bounds loops — one hop covers
 * the realistic cases (router, trailing-slash normalizer).
 */
const MAX_COWORKER_REDIRECTS = 3;
const SOKOSUMI_SUPPORTED_URL_PATTERNS: Record<string, RegExp[]> = {
  // The Responses API mapping forwards these as image_url/file_url or inline data.
  "*": [/^https?:\/\//i, /^data:/i],
};

export type SokosumiLanguageModel = LanguageModelV4 & {
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
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    const streamResult = await doStream(options);
    const reader = streamResult.stream.getReader();
    const content: LanguageModelV4Content[] = [];
    let textBuffer = "";
    let reasoningBuffer = "";
    let warnings: SharedV4Warning[] = [];
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
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
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
    specificationVersion: "v4",
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
  promptWarnings: SharedV4Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV4CallOptions,
): Promise<LanguageModelV4StreamResult> {
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
    stream: createResponsesSseToV4Stream(response.body, {
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
  promptWarnings: SharedV4Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV4CallOptions,
  attempt = 0,
): Promise<LanguageModelV4StreamResult> {
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
  promptWarnings: SharedV4Warning[],
  sokosumiOpts: ReturnType<typeof parseSokosumiProviderOptions>,
  options: LanguageModelV4CallOptions,
): Promise<LanguageModelV4StreamResult> {
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

  /**
   * POSTs to the coworker Responses endpoint, validating the target before the
   * socket opens and again on every redirect hop.
   *
   * The URL is built from vendor-supplied `coworkerBaseUrl`, so the guard must
   * run per request (not once per call): a rebinding DNS record could
   * otherwise slip an internal address into the retry below. Redirects are
   * followed MANUALLY rather than refused outright — an endpoint behind a
   * router or a trailing-slash normalizer legitimately redirects — but each
   * hop is re-validated, so a public host cannot bounce this POST (identity
   * headers and all) to an internal one.
   *
   * Only 307/308 are followed: the other 3xx codes downgrade a POST to GET,
   * which this API cannot answer, so following them would silently drop the
   * request body.
   */
  async function postWithValidatedRedirects(
    requestBody: CoworkerResponsesBody,
  ): Promise<Response> {
    const initialOrigin = new URL(url).origin;
    let target = url;
    for (let hop = 0; hop <= MAX_COWORKER_REDIRECTS; hop++) {
      await sokosumiOpts.assertUrlAllowed?.(target);
      const response = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: options.abortSignal,
        redirect: "manual",
      });

      if (response.status !== 307 && response.status !== 308) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      const redirectTarget = new URL(location, target);
      // Same-origin only. `assertUrlAllowed` rejects private addresses but not
      // third-party PUBLIC ones, so without this a vendor could redirect to a
      // host it controls and be handed `headers` — the Sokosumi user and
      // organization ids — plus the full prompt body. Router and
      // trailing-slash redirects, the cases this loop exists for, are all
      // same-origin.
      if (redirectTarget.origin !== initialOrigin) {
        throw new Error(
          "Coworker Responses API redirected to a different origin",
        );
      }
      target = redirectTarget.toString();
    }
    throw new Error(
      `Coworker Responses API exceeded ${MAX_COWORKER_REDIRECTS} redirects`,
    );
  }

  async function fetchCoworkerResponses(
    requestBody: CoworkerResponsesBody,
  ): Promise<Response> {
    let response = await postWithValidatedRedirects(requestBody);

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
        response = await postWithValidatedRedirects(retryBody);
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
    stream: createResponsesSseToV4Stream(response.body, {
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
