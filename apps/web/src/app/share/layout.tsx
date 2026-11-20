import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SHARE_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { readRouteSession } from "@/lib/auth/route-session";

interface ShareLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Share.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default function ShareLayout({ children }: ShareLayoutProps) {
  return (
    <ClientMessageBoundary paths={SHARE_MESSAGE_PATHS}>
      <div className="flex w-full flex-col overflow-clip">
        <Suspense fallback={null}>
          <ShareImpersonationBanner />
        </Suspense>
        {children}
      </div>
    </ClientMessageBoundary>
  );
}

// Share pages render outside the app chrome, so the banner is mounted
// explicitly: an impersonating admin opening a share link keeps sight of
// the impersonation state — and Exit. The layout itself stays sync so the
// public shell keeps prerendering; the session read streams in the Suspense
// hole above (same shape as not-found). Anonymous reads short-circuit
// without Core I/O. Exported for tests: async Server Components can't
// render in happy-dom, so tests await it directly.
export async function ShareImpersonationBanner() {
  const sessionRead = await readRouteSession();
  if (sessionRead.status !== "authenticated") {
    return null;
  }
  const session = sessionRead.session;
  return (
    <ImpersonationBanner
      name={session.user.name}
      email={session.user.email}
      impersonatedBy={session.session.impersonatedBy ?? null}
    />
  );
}
