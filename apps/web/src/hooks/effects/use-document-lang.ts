"use client";

import { useLayoutEffect } from "react";

import { createDomPropertyStack } from "./dom-property-stack";

const claimDocumentLang = createDomPropertyStack<string>({
  read: () => document.documentElement.lang,
  write: (_key, value) => {
    document.documentElement.lang = value;
  },
});

/**
 * Synchronizes `document.documentElement.lang` before paint so the root
 * `<html>` language matches the active owner, preserving overlapping owners
 * and restoring the previous language on cleanup.
 */
export function useDocumentLang(lang: string): void {
  useLayoutEffect(() => {
    return claimDocumentLang("lang", lang);
  }, [lang]);
}
