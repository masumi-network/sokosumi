import { createRoute, z } from "@hono/zod-openapi";
import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { coworkerTextLooksLikeAgentError } from "@sokosumi/ai-provider";
import {
  chatModelSupportsWebSearch,
  getChatModelImageGenerationOpenRouterId,
} from "@sokosumi/chat";
import { extractReactEnvelope } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import {
  convertToModelMessages,
  generateId,
  streamText,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { openrouterClient } from "@/clients/openrouter.client";
import { LIMITS } from "@/config/constants";
import {
  requireConversationCoworkerAccess,
  requireCoworkerChatCapability,
} from "@/helpers/access-control";
import {
  clearActiveUiStreamIdInMetadata,
  setActiveUiStreamIdInMetadata,
} from "@/helpers/active-ui-stream-metadata";
import { conversationMessagesToUiMessages } from "@/helpers/conversation-messages-to-ui-messages";
import {
  clearPendingResponseMirror,
  getPendingResponseMirror,
  setPendingResponseMirror,
} from "@/helpers/coworker-pending-response-mirror";
import { pollCoworkerResponseStatus } from "@/helpers/coworker-response-poll";
import {
  acquireStreamLock,
  releaseStreamLock,
  startStreamLockHeartbeat,
} from "@/helpers/coworker-stream-lock";
import {
  badRequest,
  conflict,
  forbidden,
  internalServerError,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import {
  buildMessageTitleSource,
  extractMessageText,
  extractPersistableUiParts,
  extractReasoningPartsFromMessage,
  hasModelVisibleMessageContent,
  type PersistedChatUiFilePart,
  type PersistedChatUiPart,
} from "@/helpers/message-content";
import { jsonErrorResponse } from "@/helpers/openapi";
import { persistAssistantFromAiSdk } from "@/helpers/persist-assistant-from-ai-sdk";
import {
  clearCoworkerResponseChain,
  clearPendingAndSetPrevious,
  clearPendingResponseId,
  persistPendingResponseId,
} from "@/helpers/persist-pending-response-id";
import { normalizeSafeRemoteUrl } from "@/helpers/safe-url";
import {
  isGeneratedChatImageDataUri,
  uploadGeneratedChatImage,
} from "@/lib/blob";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import {
  getOpenRouterChatApiKeyForProvider,
  getSokosumiProvider,
} from "@/lib/sokosumi-ai-provider";
import {
  forbidOrchestratorActor,
  isUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import {
  AI_SDK_CHAT_MESSAGES_REQUIREMENT,
  aiSdkChatRequestSchema,
} from "@/schemas/chat-request.schema.js";
import {
  ensureCoworkerProviderConversation,
  throwCoworkerRemoteConversationHttpError,
} from "./coworker-conversation";

import { mapChatRequestToUiMessages } from "./map-chat-request-to-ui-messages.js";

const GENERATED_IMAGE_MARKDOWN_REGEX =
  /!\[[^\]\n]*\]\((data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,[^)]+|https?:\/\/[^)\s]+)\)/gi;

/** Shown when image markdown was stripped but blob upload failed and there is no caption left. */
const ASSISTANT_GENERATED_IMAGE_UPLOAD_FAILED_FALLBACK =
  "The generated image could not be saved. Try generating again.";

/** Shown when a model describes image tool use but never returns an image. */
const ASSISTANT_GENERATED_IMAGE_UNAVAILABLE_FALLBACK =
  "The image generation tool did not return an image. Try generating again.";

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function messageRequestedImageGeneration(
  message: Record<string, unknown>,
): boolean {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  return (metadata as Record<string, unknown>).imageGeneration === true;
}

function conversationUsesImageGeneration(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.image_generation === true;
}

function filenameFromImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const filename = pathname.split("/").filter(Boolean).pop()?.trim();
    return filename && filename.length > 0 ? filename : "generated-image";
  } catch {
    return "generated-image";
  }
}

function inferImageMediaTypeFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const extension = parsed.pathname
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9+]/g, "");
    if (extension && IMAGE_MEDIA_TYPE_BY_EXTENSION[extension]) {
      return IMAGE_MEDIA_TYPE_BY_EXTENSION[extension];
    }
  } catch {
    return "image/png";
  }

  return "image/png";
}

function extractGeneratedImageMarkdown(text: string): {
  strippedText: string;
  imageUrls: string[];
} {
  const imageUrls: string[] = [];
  const strippedText = text
    .replace(GENERATED_IMAGE_MARKDOWN_REGEX, (_match, imageUrl: string) => {
      imageUrls.push(imageUrl.trim());
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    strippedText,
    imageUrls: [...new Set(imageUrls)],
  };
}

async function buildGeneratedImageFileParts(params: {
  imageUrls: string[];
  userId: string;
  conversationId: string;
}): Promise<PersistedChatUiFilePart[]> {
  const parts: PersistedChatUiFilePart[] = [];

  for (const imageUrl of params.imageUrls) {
    if (isGeneratedChatImageDataUri(imageUrl)) {
      const uploaded = await uploadGeneratedChatImage({
        dataUrl: imageUrl,
        userId: params.userId,
        conversationId: params.conversationId,
      });

      if (uploaded) {
        parts.push({
          type: "file",
          url: uploaded.url,
          mediaType: uploaded.mediaType,
          filename: uploaded.filename,
        });
      }
      continue;
    }

    const normalizedUrl = normalizeSafeRemoteUrl(imageUrl);
    if (!normalizedUrl) {
      console.warn("Skipping unsafe generated image URL in chat finish text");
      continue;
    }

    parts.push({
      type: "file",
      url: normalizedUrl,
      mediaType: inferImageMediaTypeFromUrl(normalizedUrl),
      filename: filenameFromImageUrl(normalizedUrl),
    });
  }

  return parts;
}

async function prepareAssistantFinishForPersistence(params: {
  text: string;
  userId: string;
  conversationId: string;
  modelId: string | null;
  /** When false, leave assistant text unchanged (normal chat may include `![](https://…)`). */
  extractGeneratedImagesFromMarkdown: boolean;
}): Promise<{
  text: string;
  uiParts?: PersistedChatUiPart[];
  reactThought?: string;
}> {
  const imageExtraction = params.extractGeneratedImagesFromMarkdown
    ? extractGeneratedImageMarkdown(params.text)
    : { strippedText: params.text, imageUrls: [] };
  if (!params.extractGeneratedImagesFromMarkdown) {
    return { text: params.text };
  }

  const {
    strippedText: textWithoutReactEnvelope,
    thought,
    hadEnvelope,
  } = extractReactEnvelope(imageExtraction.strippedText);
  const reactThought = thought?.trim() ? thought : undefined;

  const { imageUrls } = imageExtraction;
  if (imageUrls.length === 0) {
    const visibleText = hadEnvelope ? textWithoutReactEnvelope : params.text;
    if (visibleText.trim().length === 0) {
      console.warn("Image generation requested but no image was returned", {
        modelId: params.modelId,
      });
      return {
        text: ASSISTANT_GENERATED_IMAGE_UNAVAILABLE_FALLBACK,
        reactThought,
      };
    }
    return {
      text: visibleText,
      reactThought,
    };
  }

  const fileParts = await buildGeneratedImageFileParts({
    imageUrls,
    userId: params.userId,
    conversationId: params.conversationId,
  });

  if (fileParts.length > 0) {
    return {
      text: textWithoutReactEnvelope,
      reactThought,
      uiParts: [
        ...(textWithoutReactEnvelope
          ? ([
              { type: "text", text: textWithoutReactEnvelope },
            ] satisfies PersistedChatUiPart[])
          : []),
        ...fileParts,
      ],
    };
  }

  const hadDataImageUrl = imageUrls.some((url) =>
    isGeneratedChatImageDataUri(url),
  );

  if (!hadDataImageUrl) {
    return {
      text: hadEnvelope ? textWithoutReactEnvelope : params.text,
      reactThought,
    };
  }

  if (textWithoutReactEnvelope.trim().length === 0) {
    return {
      text: ASSISTANT_GENERATED_IMAGE_UPLOAD_FAILED_FALLBACK,
      reactThought,
    };
  }

  return { text: textWithoutReactEnvelope, reactThought };
}

async function persistUserOrSystemTurnForConversation(params: {
  conversationId: string;
  userId: string;
  lastMessage: { role: string } & Record<string, unknown>;
  extractedText: string;
  imageGeneration?: boolean;
}): Promise<void> {
  const { conversationId, userId, lastMessage, extractedText } = params;
  if (lastMessage.role !== "user" && lastMessage.role !== "system") {
    return;
  }

  const reasoningParts = extractReasoningPartsFromMessage(lastMessage);
  const uiParts = extractPersistableUiParts(lastMessage);
  const titleSource = buildMessageTitleSource(lastMessage);
  const isImageGeneration =
    lastMessage.role === "user" &&
    (params.imageGeneration === true ||
      messageRequestedImageGeneration(lastMessage));
  const metadata =
    reasoningParts.length > 0 || uiParts.length > 0 || isImageGeneration
      ? {
          ...(reasoningParts.length > 0 ? { reasoning: reasoningParts } : {}),
          ...(uiParts.length > 0 ? { ui_message_v1: { parts: uiParts } } : {}),
          ...(isImageGeneration ? { image_generation: true } : {}),
        }
      : undefined;

  const scheduleTitleGeneration = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "conversation"
      WHERE "id" = ${conversationId} AND "userId" = ${userId} AND "archivedAt" IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw notFound("Conversation not found");
    }

    const itemCountBefore = await tx.conversationMessage.count({
      where: { conversationId },
    });
    const isFirstUserMessage =
      itemCountBefore === 0 &&
      lastMessage.role === "user" &&
      titleSource !== null;

    await tx.conversationMessage.create({
      data: {
        conversationId,
        role: lastMessage.role,
        contentType: uiParts[0]?.type ?? null,
        contentText: extractedText,
        metadata,
      },
    });

    return isFirstUserMessage;
  });

  if (scheduleTitleGeneration) {
    waitUntil(
      (async () => {
        try {
          const generatedTitle = await openrouterClient.generateChatTitle(
            titleSource ?? extractedText,
          );
          if (generatedTitle) {
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { title: generatedTitle },
            });
          }
        } catch (err) {
          console.error("Failed to generate/update title:", err);
        }
      })(),
    );
  }
}

interface CoworkerStreamPreambleResult {
  releaseOwnedStreamLock: () => Promise<void>;
}

async function runCoworkerStreamPreamble(params: {
  conversationId: string;
  userId: string;
  organizationId: string | null;
  metadata: Record<string, unknown> | null;
  coworker: { slug: string; baseURL: string };
}): Promise<CoworkerStreamPreambleResult> {
  const streamLock = await acquireStreamLock(params.conversationId);
  if (streamLock.status === "held") {
    throw conflict(
      "A coworker response is already in progress for this conversation.",
    );
  }
  const streamLockOwnerToken =
    streamLock.status === "acquired" ? streamLock.ownerToken : null;

  const releaseOwnedStreamLock = async () => {
    if (streamLockOwnerToken) {
      await releaseStreamLock(params.conversationId, streamLockOwnerToken);
    }
  };

  try {
    const metadataPending = params.metadata?.pending_responses_api_response_id;
    const mirroredPending = await getPendingResponseMirror(
      params.conversationId,
    );
    const pendingResponseId =
      (typeof metadataPending === "string" && metadataPending.trim().length > 0
        ? metadataPending.trim()
        : null) ?? mirroredPending;

    if (pendingResponseId) {
      const pollResult = await pollCoworkerResponseStatus({
        responsesApiBaseUrl: params.coworker.baseURL,
        responseId: pendingResponseId,
        userId: params.userId,
        organizationId: params.organizationId,
        coworkerSlug: params.coworker.slug,
      });

      if (pollResult.status === "in_progress") {
        throw conflict(
          "A coworker response is already in progress for this conversation.",
        );
      }

      if (pollResult.status === "error") {
        await clearPendingResponseId({
          conversationId: params.conversationId,
          userId: params.userId,
        });
        await clearPendingResponseMirror(params.conversationId);
        throw serviceUnavailable(
          "Coworker chat could not verify an in-flight response. Try again shortly.",
          { reportToSentry: false },
        );
      }

      await clearPendingResponseId({
        conversationId: params.conversationId,
        userId: params.userId,
      });
      await clearPendingResponseMirror(params.conversationId);
    }
  } catch (error) {
    await releaseOwnedStreamLock();
    throw error;
  }

  const stopHeartbeat = streamLockOwnerToken
    ? startStreamLockHeartbeat(params.conversationId, streamLockOwnerToken)
    : null;

  return {
    releaseOwnedStreamLock: async () => {
      stopHeartbeat?.();
      await releaseOwnedStreamLock();
    },
  };
}

async function validateUiMessagesOrBadRequest(
  messages: UIMessage[],
): Promise<void> {
  try {
    await validateUIMessages({ messages });
  } catch (error) {
    throw badRequest(
      error instanceof Error
        ? error.message
        : "Invalid chat messages for AI SDK.",
    );
  }
}

const route = createRoute({
  method: "post",
  path: "/",
  description:
    "Stream chat via Vercel AI SDK (`@sokosumi/ai-provider`) to OpenRouter or a coworker Responses endpoint.",
  tags: ["Chat"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: aiSdkChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Streaming UI message response (AI SDK)",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
    400: jsonErrorResponse("Invalid request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Conversation not found"),
    409: jsonErrorResponse("Conflict"),
    503: jsonErrorResponse("Service Unavailable"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(withGlobalHeaderParameters(route), async (c) => {
    let logImageGenerationRequest = false;
    let logConversationId: string | null = null;
    let logSelectedModel: string | null = null;
    let logImageGenerationModel: string | null = null;
    let releaseOwnedCoworkerStreamLock: (() => Promise<void>) | null = null;
    const finalizeCoworkerStreamLock = () => {
      const release = releaseOwnedCoworkerStreamLock;
      if (!release) {
        return;
      }
      releaseOwnedCoworkerStreamLock = null;
      waitUntil(release());
    };
    try {
      forbidOrchestratorActor(
        c.var.authContext,
        "Orchestrator cannot access marketplace conversations",
      );
      const userContext = requireUserContext(c.var.authContext);

      const {
        messages,
        message: singleMessage,
        conversationId,
        model,
        imageGeneration,
        trigger,
        previousResponseId: previousResponseIdFromRequest,
      } = c.req.valid("json");

      // A delegated coworker may only act on a conversation assigned to it.
      // Without a conversationId there is no resource to authorize against, so a
      // coworker would be driving a transient chat as the delegated user — deny.
      if (!isUserAuthContext(c.var.authContext) && !conversationId) {
        throw forbidden(
          "You can only access conversations assigned to your coworker",
        );
      }

      const useServerMergedHistory =
        Boolean(conversationId) &&
        singleMessage !== undefined &&
        trigger === "submit-message";

      let internalConversationId: string | null = null;
      let selectedModel: string | null = model ?? null;
      let conversation: Awaited<
        ReturnType<typeof prisma.conversation.findFirst>
      > = null;

      if (conversationId) {
        conversation = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            userId: userContext.userId,
            archivedAt: null,
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        // Per-resource delegation check: a delegated coworker may only act on a
        // conversation bound to it (no-op for real user sessions).
        await requireConversationCoworkerAccess(
          c.var.authContext,
          conversation.metadata,
        );

        internalConversationId = conversation.id;

        if (!selectedModel) {
          const meta = conversation.metadata as Record<string, unknown> | null;
          const modelId = meta?.model_id as string | undefined;
          if (modelId) {
            selectedModel = modelId;
          }
        }
      }

      const incomingLast =
        useServerMergedHistory && singleMessage
          ? singleMessage
          : Array.isArray(messages) && messages.length > 0
            ? messages[messages.length - 1]!
            : null;

      const lastUserMessageText =
        incomingLast &&
        (incomingLast.role === "user" || incomingLast.role === "system")
          ? (() => {
              const lastMessage = incomingLast;
              if ("parts" in lastMessage && Array.isArray(lastMessage.parts)) {
                return lastMessage.parts
                  .map((part: { type?: string; text?: string }) =>
                    part.type === "text" && part.text ? part.text : "",
                  )
                  .filter(Boolean)
                  .join("");
              }
              return extractMessageText(lastMessage as Record<string, unknown>);
            })()
          : null;
      const lastMessageHasCoworkerCompatibleContent =
        incomingLast &&
        (incomingLast.role === "user" || incomingLast.role === "system")
          ? incomingLast.role === "user"
            ? hasModelVisibleMessageContent(
                incomingLast as Record<string, unknown>,
              )
            : (lastUserMessageText?.trim().length ?? 0) > 0
          : false;

      let metadata = (conversation?.metadata ?? null) as Record<
        string,
        unknown
      > | null;
      const messageImageGenerationRequested =
        incomingLast != null &&
        messageRequestedImageGeneration(
          incomingLast as Record<string, unknown>,
        );
      const conversationImageGeneration =
        conversationUsesImageGeneration(metadata);
      const effectiveImageGeneration =
        imageGeneration === true ||
        messageImageGenerationRequested ||
        conversationImageGeneration;
      const coworkerSlug = metadata?.coworker_slug as string | undefined;
      const coworkerId = metadata?.coworker_id as string | undefined;
      let coworker: {
        id: string;
        slug: string;
        baseURL: string | null;
      } | null = null;

      if (coworkerSlug || coworkerId) {
        // Anchor on coworker_id (verified by requireConversationCoworkerAccess)
        // when present, falling back to coworker_slug only before the binding is
        // stamped. Resolving slug-first would let a divergent coworker_slug
        // route a delegated request to another coworker's Responses endpoint
        // even though the guard authorized it against the matching coworker_id.
        const coworkerIdentity = await prisma.coworker.findFirst({
          where: {
            archivedAt: null,
            ...(coworkerId ? { id: coworkerId } : { slug: coworkerSlug }),
          },
          select: { id: true },
        });

        if (!coworkerIdentity) {
          throw notFound("Coworker not found");
        }

        coworker = await requireCoworkerChatCapability(coworkerIdentity.id);
      }

      const useCoworker = Boolean(internalConversationId) && Boolean(coworker);
      let imageGenerationModel: string | null = null;

      if (effectiveImageGeneration) {
        if (useCoworker) {
          throw badRequest(
            "Image generation is only available for supported chat models.",
          );
        }

        imageGenerationModel =
          getChatModelImageGenerationOpenRouterId(selectedModel);
        if (!imageGenerationModel) {
          throw badRequest("Selected model does not support image generation.");
        }
      }
      if (
        effectiveImageGeneration &&
        !conversationImageGeneration &&
        internalConversationId
      ) {
        metadata = {
          ...(metadata ?? {}),
          image_generation: true,
          userId: userContext.userId,
        };
        await prisma.conversation.update({
          where: {
            id: internalConversationId,
            userId: userContext.userId,
          },
          data: { metadata },
        });
      }
      logImageGenerationRequest = effectiveImageGeneration;
      logConversationId = internalConversationId;
      logSelectedModel = selectedModel;
      logImageGenerationModel = imageGenerationModel;

      if (useCoworker) {
        if (!lastMessageHasCoworkerCompatibleContent) {
          throw badRequest(
            "Coworker chat requires a user or system message to respond to; send a user message with text or an attachment, or a system message with text.",
          );
        }
        if (!coworker?.baseURL?.trim()) {
          throw serviceUnavailable(
            "Coworker chat is not available: no Responses API URL configured for this coworker.",
          );
        }
      }

      if (!useCoworker) {
        const chatKey = getOpenRouterChatApiKeyForProvider();
        if (!chatKey.trim()) {
          throw serviceUnavailable("OpenRouter chat API key not configured");
        }
      }

      if (useCoworker && internalConversationId && coworker?.baseURL?.trim()) {
        const preamble = await runCoworkerStreamPreamble({
          conversationId: internalConversationId,
          userId: userContext.userId,
          organizationId: userContext.organizationId ?? null,
          metadata,
          coworker: {
            slug: coworker.slug,
            baseURL: coworker.baseURL.trim(),
          },
        });
        releaseOwnedCoworkerStreamLock = preamble.releaseOwnedStreamLock;
      }

      let uiMessages;
      if (
        useServerMergedHistory &&
        internalConversationId &&
        singleMessage !== undefined
      ) {
        const tailUiForValidation = mapChatRequestToUiMessages([singleMessage]);
        await validateUiMessagesOrBadRequest(tailUiForValidation);

        if (internalConversationId && incomingLast) {
          await persistUserOrSystemTurnForConversation({
            conversationId: internalConversationId,
            userId: userContext.userId,
            lastMessage: incomingLast,
            extractedText: lastUserMessageText ?? "",
            ...(effectiveImageGeneration ? { imageGeneration: true } : {}),
          });
        }

        const persistedMessagesNewestFirst =
          await prisma.conversationMessage.findMany({
            where: { conversationId: internalConversationId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT,
            select: { id: true, role: true, contentText: true, metadata: true },
          });
        const persistedMessages = [...persistedMessagesNewestFirst].reverse();
        uiMessages = conversationMessagesToUiMessages(persistedMessages);

        if (
          incomingLast != null &&
          incomingLast.role !== "user" &&
          incomingLast.role !== "system"
        ) {
          uiMessages = [
            ...uiMessages,
            ...mapChatRequestToUiMessages([singleMessage]),
          ];
        }

        await validateUiMessagesOrBadRequest(uiMessages);
      } else {
        if (!Array.isArray(messages) || messages.length === 0) {
          throw unprocessableEntity(AI_SDK_CHAT_MESSAGES_REQUIREMENT);
        }
        uiMessages = mapChatRequestToUiMessages(messages);

        await validateUiMessagesOrBadRequest(uiMessages);

        if (internalConversationId && incomingLast) {
          await persistUserOrSystemTurnForConversation({
            conversationId: internalConversationId,
            userId: userContext.userId,
            lastMessage: incomingLast,
            extractedText: lastUserMessageText ?? "",
            ...(effectiveImageGeneration ? { imageGeneration: true } : {}),
          });
        }
      }

      let providerConversationId = conversation?.providerConversationId ?? null;

      if (
        useCoworker &&
        coworker &&
        internalConversationId &&
        !providerConversationId
      ) {
        try {
          const ensured = await ensureCoworkerProviderConversation({
            internalConversationId,
            userId: userContext.userId,
            organizationId: userContext.organizationId ?? null,
            coworkerSlug: coworker.slug,
            responsesApiBaseUrl: coworker.baseURL!.trim(),
          });
          providerConversationId = ensured.providerConversationId;
        } catch (error) {
          throwCoworkerRemoteConversationHttpError(error);
        }
      }

      if (useCoworker && !providerConversationId?.trim()) {
        throw serviceUnavailable(
          "Coworker chat could not create or resolve a remote conversation. Try again shortly.",
        );
      }

      const coworkerConversationsMode = Boolean(
        useCoworker && coworker && providerConversationId,
      );

      if (internalConversationId && isUiStreamResumptionConfigured()) {
        try {
          await clearActiveUiStreamIdInMetadata({
            conversationId: internalConversationId,
            userId: userContext.userId,
          });
        } catch (error) {
          console.error(
            "Failed to clear active UI stream id before new chat stream:",
            error,
          );
        }
      }

      if (effectiveImageGeneration) {
        console.info("Starting OpenRouter image generation chat stream", {
          conversationId: internalConversationId,
          model: selectedModel,
          imageGenerationModel,
          messageCount: uiMessages.length,
        });
      }

      const modelMessages = await convertToModelMessages(
        uiMessages.map(({ id: _id, ...rest }) => rest),
      );

      const responsesApiResponseIdRef: { current: string | null } = {
        current: null,
      };

      const thoughtPhaseMs = {
        start: null as number | null,
        end: null as number | null,
        sawReasoningChunk: false,
      };

      let uiStreamResumptionRegistered = false;
      let uiStreamResumptionRegistration: Promise<void> | undefined;

      let onInvalidProviderConversationId: (() => Promise<void>) | undefined;
      if (useCoworker && internalConversationId) {
        const conversationIdForInvalidProviderConv = internalConversationId;
        onInvalidProviderConversationId = async () => {
          try {
            await prisma.conversation.update({
              where: {
                id: conversationIdForInvalidProviderConv,
                userId: userContext.userId,
              },
              data: { providerConversationId: null },
            });
          } catch (error) {
            console.error(
              "Failed to clear providerConversationId after invalid remote conversation (POST /chat):",
              error,
            );
          }
        };
      }

      const resolvedCoworkerPreviousResponseId = (() => {
        if (!useCoworker) {
          return null;
        }
        if (providerConversationId?.trim()) {
          return null;
        }
        const fromRequest = previousResponseIdFromRequest?.trim();
        if (fromRequest) {
          return fromRequest;
        }
        const fromMeta = metadata?.previous_response_id;
        if (typeof fromMeta === "string" && fromMeta.trim()) {
          return fromMeta.trim();
        }
        return null;
      })();
      const webSearchEnabled =
        !useCoworker && chatModelSupportsWebSearch(selectedModel);

      const sokosumiProviderOptions: SokosumiProviderCallOptions = {
        mode: useCoworker ? "coworker" : "openrouter",
        coworkerBaseUrl: coworker?.baseURL ?? null,
        coworkerSlug: coworker?.slug ?? null,
        sokosumiUserId: userContext.userId,
        sokosumiOrganizationId: userContext.organizationId ?? null,
        previousResponseId: resolvedCoworkerPreviousResponseId,
        providerConversationId: coworkerConversationsMode
          ? providerConversationId
          : null,
        imageGenerationModel,
        webSearchEnabled,
        onResponseStarted: async (responseId: string) => {
          responsesApiResponseIdRef.current = responseId;
          if (!internalConversationId || !coworker) {
            return;
          }
          try {
            await setPendingResponseMirror(internalConversationId, responseId);
            await persistPendingResponseId({
              conversationId: internalConversationId,
              userId: userContext.userId,
              responseId,
              coworkerSlug: coworker.slug,
              coworkerId: coworker.id,
            });
          } catch (error) {
            console.error("Failed to persist pending response id:", error);
          }
        },
        onResponseCompleted: async (responseId: string) => {
          if (!internalConversationId) {
            return;
          }
          try {
            await clearPendingResponseMirror(internalConversationId);
            if (coworkerConversationsMode) {
              await clearPendingResponseId({
                conversationId: internalConversationId,
                userId: userContext.userId,
              });
            } else {
              await clearPendingAndSetPrevious({
                conversationId: internalConversationId,
                userId: userContext.userId,
                responseId,
              });
            }
          } catch (error) {
            console.error(
              "Failed to clear pending and set previous response id:",
              error,
            );
          }
        },
        onInvalidProviderConversationId,
      };

      const result = streamText({
        model: getSokosumiProvider()(selectedModel),
        messages: modelMessages,
        allowSystemInMessages: true,
        maxRetries: 0,
        providerOptions: {
          sokosumi: sokosumiProviderOptions,
        } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
        onChunk: ({ chunk }) => {
          if (!useCoworker) {
            return;
          }
          const chunkType = chunk.type as string;
          if (
            chunkType === "reasoning-start" ||
            chunkType === "reasoning-delta"
          ) {
            thoughtPhaseMs.sawReasoningChunk = true;
            thoughtPhaseMs.start = thoughtPhaseMs.start ?? Date.now();
          }
          if (chunkType === "reasoning-end") {
            thoughtPhaseMs.end = Date.now();
          }
          if (
            chunk.type === "text-delta" &&
            thoughtPhaseMs.sawReasoningChunk &&
            thoughtPhaseMs.end == null
          ) {
            thoughtPhaseMs.end = Date.now();
          }
        },
        onFinish: async (finishEvent) => {
          if (!internalConversationId) {
            return;
          }
          const shouldClearCoworkerChain =
            useCoworker && coworkerTextLooksLikeAgentError(finishEvent.text);
          try {
            const hasReasoning =
              Array.isArray(finishEvent.reasoning) &&
              finishEvent.reasoning.length > 0;
            if (
              useCoworker &&
              hasReasoning &&
              thoughtPhaseMs.start != null &&
              thoughtPhaseMs.end == null
            ) {
              thoughtPhaseMs.end = Date.now();
            }
            const thoughtTiming =
              useCoworker && hasReasoning && thoughtPhaseMs.start != null
                ? {
                    startedAtMs: thoughtPhaseMs.start,
                    endedAtMs: thoughtPhaseMs.end ?? Date.now(),
                  }
                : undefined;
            const preparedAssistantMessage =
              await prepareAssistantFinishForPersistence({
                text: finishEvent.text,
                conversationId: internalConversationId,
                userId: userContext.userId,
                modelId: selectedModel,
                extractGeneratedImagesFromMarkdown: effectiveImageGeneration,
              });
            const reasoning = [
              ...(preparedAssistantMessage.reactThought
                ? [
                    {
                      type: "reasoning",
                      text: preparedAssistantMessage.reactThought,
                    },
                  ]
                : []),
              ...(Array.isArray(finishEvent.reasoning)
                ? finishEvent.reasoning
                : []),
            ];
            await persistAssistantFromAiSdk({
              conversationId: internalConversationId,
              userId: userContext.userId,
              text: preparedAssistantMessage.text,
              responsesApiResponseId: responsesApiResponseIdRef.current,
              reasoning: reasoning.length > 0 ? reasoning : undefined,
              thoughtTiming,
              uiParts: preparedAssistantMessage.uiParts,
            });
          } catch (error) {
            console.error(
              "Failed to persist assistant message (POST /chat):",
              error,
            );
          } finally {
            if (shouldClearCoworkerChain) {
              try {
                await clearCoworkerResponseChain({
                  conversationId: internalConversationId,
                  userId: userContext.userId,
                });
              } catch (clearError) {
                console.error(
                  "Failed to clear coworker response chain (POST /chat):",
                  clearError,
                );
              }
            }
          }
        },
      });

      const enableResumableUiStream =
        Boolean(internalConversationId) && isUiStreamResumptionConfigured();

      const coworkerStreamResponseOptions = releaseOwnedCoworkerStreamLock
        ? {
            onError: (error: unknown) => {
              console.error(
                "Coworker chat UI stream error (POST /chat):",
                error,
              );
              finalizeCoworkerStreamLock();
              return "An error occurred.";
            },
          }
        : {};

      return result.toUIMessageStreamResponse({
        originalMessages: uiMessages,
        generateMessageId: generateId,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...(internalConversationId
            ? { "x-sokosumi-conversation-id": internalConversationId }
            : {}),
        },
        ...coworkerStreamResponseOptions,
        ...(enableResumableUiStream && internalConversationId
          ? {
              consumeSseStream: async ({ stream }) => {
                const streamId = generateId();
                const convId = internalConversationId;
                const userId = userContext.userId;
                const registration = (async () => {
                  try {
                    const ctx = getResumableUiStreamContext();
                    await ctx.createNewResumableStream(streamId, () => stream);
                    await setActiveUiStreamIdInMetadata({
                      conversationId: convId,
                      userId,
                      streamId,
                    });
                    uiStreamResumptionRegistered = true;
                  } catch (error) {
                    console.error(
                      "Failed to register resumable UI message stream:",
                      error,
                    );
                  }
                })();
                uiStreamResumptionRegistration = registration;
                await registration;
              },
              onFinish: async () => {
                finalizeCoworkerStreamLock();
                if (uiStreamResumptionRegistration) {
                  await uiStreamResumptionRegistration;
                }
                if (!uiStreamResumptionRegistered) {
                  return;
                }
                const clearParams = {
                  conversationId: internalConversationId,
                  userId: userContext.userId,
                };
                try {
                  await clearActiveUiStreamIdInMetadata(clearParams);
                } catch (error) {
                  console.error(
                    "Failed to clear active UI stream id on stream finish:",
                    error,
                  );
                  try {
                    await clearActiveUiStreamIdInMetadata(clearParams);
                  } catch (retryError) {
                    console.error(
                      "Retry failed to clear active UI stream id on stream finish:",
                      retryError,
                    );
                  }
                }
              },
            }
          : releaseOwnedCoworkerStreamLock
            ? {
                onFinish: async () => {
                  finalizeCoworkerStreamLock();
                },
              }
            : {}),
      });
    } catch (error) {
      if (releaseOwnedCoworkerStreamLock) {
        const release = releaseOwnedCoworkerStreamLock;
        releaseOwnedCoworkerStreamLock = null;
        try {
          await release();
        } catch (releaseError) {
          console.error(
            "Failed to release coworker stream lock (POST /chat):",
            releaseError,
          );
        }
      }
      if (logImageGenerationRequest) {
        console.error("Failed to stream OpenRouter image generation chat", {
          conversationId: logConversationId,
          model: logSelectedModel,
          imageGenerationModel: logImageGenerationModel,
          error,
        });
      }
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "message" in error
      ) {
        throw error;
      }
      throw internalServerError(
        `Failed to stream chat response (POST /chat): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
