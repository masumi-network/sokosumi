import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

function getRequestLocale(acceptLanguageHeader: string | null): string {
  if (!acceptLanguageHeader) {
    return "en";
  }

  const [firstLanguage] = acceptLanguageHeader.split(",");
  const [locale] = (firstLanguage ?? "").split(";");
  const normalizedLocale = locale?.trim();

  return normalizedLocale || "en";
}

export default getRequestConfig(async () => {
  const headersList = await headers();
  const locale = getRequestLocale(headersList.get("accept-language"));
  let messages: Record<string, unknown>;

  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import("../../messages/en.json")).default;
  }

  return {
    locale,
    messages,
  };
});
