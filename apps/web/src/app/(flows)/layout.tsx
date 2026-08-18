import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { useTranslations } from "next-intl";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { AUTH_MESSAGE_PATHS } from "@/i18n/message-namespaces";

export default async function FlowsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isWorkspaceGate =
    pathname === "/setup" || pathname.startsWith("/setup/");
  const brand = <ThemedLogo LogoComponent={SokosumiLogo} priority />;

  return (
    <ClientMessageBoundary paths={AUTH_MESSAGE_PATHS}>
      <div
        className="flex h-svh gap-6 p-6"
        {...(isWorkspaceGate ? { "data-workspace-gate-shell": true } : {})}
      >
        <div className="flex h-full flex-1 flex-col gap-6">
          {isWorkspaceGate ? (
            <div data-workspace-gate-brand>{brand}</div>
          ) : (
            <Link href="/">{brand}</Link>
          )}
          <div className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center">
            {children}
          </div>
          <FlowsLayoutFooter />
        </div>
      </div>
    </ClientMessageBoundary>
  );
}

function FlowsLayoutFooter() {
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
