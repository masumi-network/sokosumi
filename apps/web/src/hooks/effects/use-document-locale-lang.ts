"use client";

import { useLayoutEffect } from "react";

/**
 * Syncs `document.documentElement.lang` with the active locale before paint.
 */
export function useDocumentLocaleLang(locale: string): void {
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
