import { InvalidPromptError } from "@ai-sdk/provider";

import type { SokosumiProviderCallOptions } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseSokosumiProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
): SokosumiProviderCallOptions {
  const raw = providerOptions?.sokosumi;
  if (!isRecord(raw)) {
    throw new InvalidPromptError({
      prompt: providerOptions,
      message:
        "providerOptions.sokosumi is required for @sokosumi/ai-provider (mode, credentials context).",
    });
  }

  const mode = raw.mode;
  if (mode !== "openrouter" && mode !== "coworker") {
    throw new InvalidPromptError({
      prompt: raw,
      message:
        'providerOptions.sokosumi.mode must be "openrouter" or "coworker".',
    });
  }

  const coworkerBaseUrl = pickString(raw.coworkerBaseUrl) ?? null;
  const coworkerSlug = pickString(raw.coworkerSlug) ?? null;
  const sokosumiUserId = pickString(raw.sokosumiUserId) ?? null;
  const sokosumiOrganizationId = pickString(raw.sokosumiOrganizationId) ?? null;
  const previousResponseId = pickString(raw.previousResponseId) ?? null;
  const providerConversationId = pickString(raw.providerConversationId) ?? null;
  const imageGenerationModel = pickString(raw.imageGenerationModel) ?? null;
  const webSearchEnabled = raw.webSearchEnabled === true;
  const webSearchParameters = isRecord(raw.webSearchParameters)
    ? raw.webSearchParameters
    : null;

  const onResponseStarted =
    typeof raw.onResponseStarted === "function"
      ? (raw.onResponseStarted as (id: string) => void | Promise<void>)
      : undefined;
  const onResponseCompleted =
    typeof raw.onResponseCompleted === "function"
      ? (raw.onResponseCompleted as (id: string) => void | Promise<void>)
      : undefined;
  const onInvalidPreviousResponseId =
    typeof raw.onInvalidPreviousResponseId === "function"
      ? (raw.onInvalidPreviousResponseId as () => void | Promise<void>)
      : undefined;
  const onInvalidProviderConversationId =
    typeof raw.onInvalidProviderConversationId === "function"
      ? (raw.onInvalidProviderConversationId as () => void | Promise<void>)
      : undefined;
  const assertUrlAllowed =
    typeof raw.assertUrlAllowed === "function"
      ? (raw.assertUrlAllowed as (url: string) => void | Promise<void>)
      : undefined;

  if (mode === "coworker") {
    if (!coworkerBaseUrl?.trim()) {
      throw new InvalidPromptError({
        prompt: raw,
        message:
          'providerOptions.sokosumi.coworkerBaseUrl is required when mode is "coworker".',
      });
    }
    if (!coworkerSlug?.trim()) {
      throw new InvalidPromptError({
        prompt: raw,
        message:
          'providerOptions.sokosumi.coworkerSlug is required when mode is "coworker".',
      });
    }
    if (!sokosumiUserId?.trim()) {
      throw new InvalidPromptError({
        prompt: raw,
        message:
          'providerOptions.sokosumi.sokosumiUserId is required when mode is "coworker".',
      });
    }
    if (!providerConversationId?.trim() && !previousResponseId?.trim()) {
      throw new InvalidPromptError({
        prompt: raw,
        message:
          'providerOptions.sokosumi.providerConversationId or providerOptions.sokosumi.previousResponseId is required when mode is "coworker".',
      });
    }
    // Fail closed: coworkerBaseUrl is vendor-controlled, so a caller that
    // forgets the guard must not silently get unchecked outbound requests.
    if (!assertUrlAllowed) {
      throw new InvalidPromptError({
        prompt: raw,
        message:
          'providerOptions.sokosumi.assertUrlAllowed is required when mode is "coworker".',
      });
    }
  }

  return {
    mode,
    coworkerBaseUrl,
    coworkerSlug,
    sokosumiUserId,
    sokosumiOrganizationId,
    previousResponseId: previousResponseId?.trim().length
      ? previousResponseId.trim()
      : null,
    providerConversationId: providerConversationId?.trim().length
      ? providerConversationId.trim()
      : null,
    imageGenerationModel: imageGenerationModel?.trim().length
      ? imageGenerationModel.trim()
      : null,
    webSearchEnabled,
    webSearchParameters,
    onResponseStarted,
    onResponseCompleted,
    onInvalidPreviousResponseId,
    onInvalidProviderConversationId,
    assertUrlAllowed,
  };
}
