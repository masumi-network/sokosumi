import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  resolveRequestLocale,
} from "@sokosumi/utils";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

interface JsonRecord {
  [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMessages(base: JsonRecord, override: JsonRecord): JsonRecord {
  const output: JsonRecord = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = output[key];

    if (isJsonRecord(baseValue) && isJsonRecord(value)) {
      output[key] = mergeMessages(baseValue, value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

export default getRequestConfig(async () => {
  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  const locale = resolveRequestLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguageHeader: headersList.get("accept-language"),
    defaultLocale: DEFAULT_LOCALE,
  });

  const englishMessages = (await import("../../messages/en.json"))
    .default as JsonRecord;
  let localeMessages: JsonRecord = {};

  try {
    localeMessages = (await import(`../../messages/${locale}.json`))
      .default as JsonRecord;
  } catch {
    localeMessages = {};
  }

  return {
    locale,
    messages: mergeMessages(englishMessages, localeMessages),
  };
});
