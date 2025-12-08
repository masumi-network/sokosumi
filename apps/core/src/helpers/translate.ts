import type { TFunction } from "i18next";

import { i18next } from "@/lib/i18next";

/**
 * Get translation function for a specific language
 * @param language - Language code (e.g., 'en', 'de')
 * @returns Translation function bound to the specified language
 */
export function getTranslationFunction(language: string): TFunction {
  return i18next.getFixedT(language);
}
