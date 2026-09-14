import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { GlobalModalsContextProvider } from "@/components/modals/global-modals-context";
import { Toaster } from "@/components/ui/sonner";
import { GLOBAL_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { pickMessages } from "@/i18n/pick-messages";

import { DocumentLocale } from "./document-locale";

interface RootProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
}

function RootProviders({ children, locale, messages }: RootProvidersProps) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DocumentLocale />
      <GlobalModalsContextProvider>
        <div className="bg-background">{children}</div>
      </GlobalModalsContextProvider>
      <Toaster />
    </NextIntlClientProvider>
  );
}

interface RootIntlTreeProps {
  children: React.ReactNode;
}

export async function RootIntlTree({ children }: RootIntlTreeProps) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const picked = pickMessages(messages, GLOBAL_MESSAGE_PATHS);

  return (
    <RootProviders locale={locale} messages={picked}>
      {children}
    </RootProviders>
  );
}
