import * as z from "zod";

import type { TranslationFunction } from "./types";

export const DIALOG_CLEANUP_TIMEOUT = 300;

export const DEFAULT_CREATE_FORM_VALUES = {
  name: "",
  redirectUris: "",
};

export function parseRedirectUris(value: string): string[] {
  return value
    .split("\n")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
}

export function redirectUrisToTextareaValue(
  uris: string[] | undefined,
): string {
  return (uris ?? []).join("\n");
}

export function formatRedirectUrisSummary(
  uris: string[] | undefined,
  moreLabel: (count: number) => string,
): string {
  const redirectUris = uris ?? [];
  if (redirectUris.length === 0) {
    return "—";
  }

  if (redirectUris.length === 1) {
    return redirectUris[0] ?? "—";
  }

  return `${redirectUris[0]} ${moreLabel(redirectUris.length - 1)}`;
}

function createRedirectUrisSchema(t: TranslationFunction) {
  return z
    .string()
    .min(1, t("Validation.redirectUrisRequired"))
    .refine(
      (value) => {
        const parsedUris = parseRedirectUris(value);
        return (
          parsedUris.length > 0 &&
          parsedUris.every((uri) => {
            try {
              new URL(uri);
              return true;
            } catch {
              return false;
            }
          })
        );
      },
      {
        message: t("Validation.redirectUrisInvalid"),
      },
    );
}

export function createOAuthClientSchema(t: TranslationFunction) {
  return z.object({
    name: z
      .string()
      .min(1, t("Validation.nameRequired"))
      .max(100, t("Validation.nameMaxLength")),
    redirectUris: createRedirectUrisSchema(t),
  });
}

export function editOAuthClientSchema(t: TranslationFunction) {
  return createOAuthClientSchema(t);
}
