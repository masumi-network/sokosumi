"use client";

import { useLocale } from "next-intl";
import { useLayoutEffect } from "react";

/**
 * Root `<html lang>` stays on `DEFAULT_LOCALE` so the document shell can stay
 * sync under Cache Components. Sync the live locale onto `documentElement`
 * after intl resolves (cookie / Accept-Language).
 */
export function DocumentLocale() {
  const locale = useLocale();

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
