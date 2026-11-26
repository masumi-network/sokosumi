import * as z from "zod";

import type { ApiKeyRecord, TranslationFunction } from "./types";

export function createApiKeySchema(t: TranslationFunction) {
  return z.object({
    name: z
      .string()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength"))
      .regex(/^[a-zA-Z0-9\s\-_]+$/, t("Validation.namePattern")),
  });
}

export function deleteApiKeySchema(t: TranslationFunction) {
  return z.object({
    keyId: z.string().min(1, t("Validation.keyIdRequired")),
    confirmName: z.string().min(1, t("Validation.confirmNameRequired")),
  });
}

export function validateConfirmationName(
  apiKeyName: string,
  confirmName: string,
  t: TranslationFunction,
): { isValid: boolean; error?: string } {
  if (apiKeyName !== confirmName) {
    return {
      isValid: false,
      error: t("Messages.confirmNameMismatch"),
    };
  }
  return { isValid: true };
}

export function getToggleActionText(
  enabled: boolean | null | undefined,
): "disabled" | "enabled" {
  return enabled ? "disabled" : "enabled";
}

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
};

export const DIALOG_CLEANUP_TIMEOUT = 300;

const RECENT_USE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Better Auth stamps `lastRequest` on every verified request. Keys made
 * without a rate-limit window are never stamped, so an empty value means no
 * recorded use, not "never used".
 */
export function lastUsedAt(apiKey: ApiKeyRecord): Date | null {
  return apiKey.lastRequest ? new Date(apiKey.lastRequest) : null;
}

export function usedInLastWeek(apiKey: ApiKeyRecord, now: number): boolean {
  const at = lastUsedAt(apiKey);
  return at !== null && now - at.getTime() < RECENT_USE_MS;
}
