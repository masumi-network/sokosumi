import type { MiddlewareHandler } from "hono";
import type { TFunction } from "i18next";

import { getTranslationFunction } from "@/helpers/translate";

export type LanguageVariables = {
  language: string;
  t: TFunction;
};

/**
 * Middleware to add translation function to context
 * Must be used after the languageDetector middleware
 */
export const translationMiddleware = (): MiddlewareHandler<{
  Variables: LanguageVariables;
}> => {
  return async (c, next) => {
    const language = c.var.language;
    const t = getTranslationFunction(language);
    c.set("t", t);
    await next();
  };
};
