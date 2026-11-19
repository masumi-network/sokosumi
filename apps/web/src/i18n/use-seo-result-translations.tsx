"use client";

import {
  createFormatter,
  createTranslator,
  type Messages,
  useFormatter,
  useLocale,
  useTimeZone,
  useTranslations,
} from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type en from "../../messages/en.json";
import { SEO_RESULT_LOCALE } from "./seo-result-messages";
import { createFormats, type HourCycle } from "./time-format";

type SeoMessages = typeof en.App.Seo;
type ReportNamespace = "App.Seo" | `App.Seo.${string}`;
const ReportContext = createContext<{
  messages: { App: { Seo: SeoMessages } };
  formats: ReturnType<typeof createFormats>;
  timeZone: string;
  format: ReturnType<typeof createFormatter>;
} | null>(null);

/** A translated SEO workspace receives only the English SEO catalog from its server page. */
export function SeoResultMessagesProvider({
  messages,
  hourCycle,
  children,
}: {
  messages: SeoMessages;
  hourCycle?: HourCycle;
  children: ReactNode;
}) {
  const timeZone = useTimeZone() ?? "UTC";
  const value = useMemo(() => {
    const formats = createFormats(hourCycle);
    return {
      messages: { App: { Seo: messages } },
      formats,
      timeZone,
      format: createFormatter({ locale: SEO_RESULT_LOCALE, formats, timeZone }),
    };
  }, [messages, timeZone, hourCycle]);
  return (
    <ReportContext.Provider value={value}>{children}</ReportContext.Provider>
  );
}

export function useSeoResultTranslations<N extends ReportNamespace>(
  namespace: N,
  reportText = true,
): ReturnType<typeof useTranslations<N>> {
  const local = useTranslations(namespace);
  const locale = useLocale();
  const report = useContext(ReportContext);
  const english = useMemo(
    () =>
      report &&
      createTranslator<Messages, N>({
        locale: SEO_RESULT_LOCALE,
        namespace,
        messages: report.messages,
        formats: report.formats,
        timeZone: report.timeZone,
      }),
    [namespace, report],
  );
  if (!reportText) return local;
  if (english) return english;
  if (locale === SEO_RESULT_LOCALE) return local;
  throw new Error("The SEO results require the English report catalog.");
}

export function useSeoResultFormatter() {
  const local = useFormatter();
  const report = useContext(ReportContext);
  return report?.format ?? local;
}
