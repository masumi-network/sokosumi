import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OrganizationProductSeatRequired } from "@/components/billing/organization-product-seat-required";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SOKO_BOT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationProductLocked } from "@/lib/auth/is-organization-product-locked";
import { hasSokoBotBetaAccess } from "@/lib/beta-access";

export const instant = false;

interface SokoBotLayoutProps {
  children: ReactNode;
}

export default async function SokoBotLayout({ children }: SokoBotLayoutProps) {
  // 404 outside the beta whitelist so the feature does not leak.
  const session = await getSession();
  if (!hasSokoBotBetaAccess(session?.user ?? null)) {
    notFound();
  }
  if (await isOrganizationProductLocked()) {
    return <OrganizationProductSeatRequired />;
  }

  return (
    <ClientMessageBoundary paths={SOKO_BOT_MESSAGE_PATHS}>
      {children}
    </ClientMessageBoundary>
  );
}
