import { z } from "zod";

import type { TranslationFunction } from "./types";

export const DIALOG_CLEANUP_TIMEOUT = 300;

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
  redirectUris: "",
};

export const DEFAULT_EDIT_FORM_VALUES = {
  name: "",
  redirectUris: "",
};

function parseRedirectUris(value: string): string[] {
  return value
    .split("\n")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
}

function areRedirectUrisValid(value: string): boolean {
  const uris = parseRedirectUris(value);
  if (uris.length === 0) {
    return false;
  }
  return uris.every((uri) => {
    try {
      new URL(uri);
      return true;
    } catch {
      return false;
    }
  });
}

export function createOAuthClientSchema(t: TranslationFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength")),
    redirectUris: z
      .string()
      .min(1, t("Validation.redirectUrisRequired"))
      .refine(areRedirectUrisValid, {
        message: t("Validation.redirectUrisInvalid"),
      }),
  });
}

export function editOAuthClientSchema(t: TranslationFunction) {
  return createOAuthClientSchema(t);
}

export { parseRedirectUris };
