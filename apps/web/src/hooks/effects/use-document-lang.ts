"use client";

import { useLayoutEffect } from "react";

/**
 * Synchronizes `document.documentElement.lang` before paint so the root
 * `<html>` language matches the resolved client locale.
 */
export function useDocumentLang(lang: string): void {
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}
