import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { pickMessages } from "@/i18n/pick-messages";

interface ClientMessageBoundaryProps {
  children: React.ReactNode;
  paths: readonly string[];
}

export async function ClientMessageBoundary({
  children,
  paths,
}: ClientMessageBoundaryProps) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const picked = pickMessages(messages, paths);

  return (
    <NextIntlClientProvider locale={locale} messages={picked}>
      {children}
    </NextIntlClientProvider>
  );
}
