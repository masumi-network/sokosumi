import Link from "next/link";
import { useTranslations } from "next-intl";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";

interface PreAppShellProps {
  children: React.ReactNode;
  brandLinked?: boolean;
  shellAttr?: string;
}

export function PreAppShell({
  children,
  brandLinked = true,
  shellAttr,
}: PreAppShellProps) {
  const brand = <ThemedLogo LogoComponent={SokosumiLogo} priority />;

  return (
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      <div
        className="flex h-svh gap-6 p-6"
        {...(shellAttr ? { [shellAttr]: true } : {})}
      >
        <div className="flex h-full flex-1 flex-col gap-6">
          {brandLinked ? (
            <Link href="/">{brand}</Link>
          ) : (
            <div data-workspace-gate-brand>{brand}</div>
          )}
          <div className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center">
            {children}
          </div>
          <PreAppShellFooter />
        </div>
      </div>
    </ClientMessageBoundary>
  );
}

function PreAppShellFooter() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex items-center justify-center gap-4">
      <Link href="/privacy-policy" className="text-sm hover:text-gray-300">
        {t("privacyPolicy")}
      </Link>
      <Link href="/terms-of-service" className="text-sm hover:text-gray-300">
        {t("termsOfServices")}
      </Link>
    </div>
  );
}
