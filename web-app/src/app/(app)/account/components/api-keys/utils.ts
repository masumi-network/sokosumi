import { z } from "zod";

import { TranslationFunction } from "./types";

/**
 * Creates validation schema for creating API keys
 */
export function createApiKeySchema(t: TranslationFunction) {
  return z.object({
    name: z
      .string()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength"))
      .regex(/^[a-zA-Z0-9\s\-_]+$/, t("Validation.namePattern")),
  });
}

/**
 * Creates validation schema for deleting API keys
 */
export function deleteApiKeySchema(t: TranslationFunction) {
  return z.object({
    keyId: z.string().min(1, t("Validation.keyIdRequired")),
    confirmName: z.string().min(1, t("Validation.confirmNameRequired")),
  });
}

/**
 * Validates that confirmation name matches the API key name
 */
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

/**
 * Formats API key display (shows only first few characters)
 */
export function formatApiKeyDisplay(key: string | null | undefined): string {
  if (!key) return "••••••••";
  return key.substring(0, 8) + "••••••••";
}

/**
 * Gets the action text for API key status toggle
 */
export function getToggleActionText(
  enabled: boolean | null | undefined,
): "disabled" | "enabled" {
  return enabled ? "disabled" : "enabled";
}

/**
 * Default form values for creating API keys
 */
export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
} as const;

/**
 * Default form values for deleting API keys
 */
export const DEFAULT_DELETE_FORM_VALUES = {
  keyId: "",
  confirmName: "",
} as const;

/**
 * Copy timeout duration in milliseconds
 */
export const COPY_SUCCESS_TIMEOUT = 3000;

/**
 * Dialog cleanup timeout duration in milliseconds
 */
export const DIALOG_CLEANUP_TIMEOUT = 300;
