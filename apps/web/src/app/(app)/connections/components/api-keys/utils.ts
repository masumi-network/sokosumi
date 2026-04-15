import * as z from "zod";

import type { TranslationFunction } from "./types";

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

export function formatApiKeyDisplay(key: string | null | undefined): string {
  if (!key) return "••••••••";
  return key.substring(0, 8) + "••••••••";
}

export function getToggleActionText(
  enabled: boolean | null | undefined,
): "disabled" | "enabled" {
  return enabled ? "disabled" : "enabled";
}

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
};

export const DEFAULT_DELETE_FORM_VALUES = {
  keyId: "",
  confirmName: "",
} as const;

export const DIALOG_CLEANUP_TIMEOUT = 300;
