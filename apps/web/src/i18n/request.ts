import {
  type AppLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  resolveRequestLocale,
} from "@sokosumi/utils";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

const messagesByLocale = {
  en,
  de,
  es,
} as const satisfies Record<AppLocale, typeof en>;

export default getRequestConfig(async () => {
  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = resolveRequestLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguageHeader: headersList.get("accept-language"),
    defaultLocale: DEFAULT_LOCALE,
  });

  return {
    locale,
    messages: messagesByLocale[locale],
  };
});
