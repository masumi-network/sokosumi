import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { GlobalModalsContextProvider } from "@/components/modals/global-modals-context";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/theme-context";

interface RootProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
}

function RootProviders({ children, locale, messages }: RootProvidersProps) {
  return (
    <NuqsAdapter>
      <ThemeProvider>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <GlobalModalsContextProvider>
            <div className="bg-background">{children}</div>
          </GlobalModalsContextProvider>
          <Toaster />
        </NextIntlClientProvider>
      </ThemeProvider>
    </NuqsAdapter>
  );
}

interface RootIntlTreeProps {
  children: React.ReactNode;
}

export async function RootIntlTree({ children }: RootIntlTreeProps) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <RootProviders locale={locale} messages={messages}>
      {children}
    </RootProviders>
  );
}
