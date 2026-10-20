import type { ReactNode } from "react";

import { OrganizationProductSeatRequired } from "@/components/billing/organization-product-seat-required";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SOKO_BOT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { isOrganizationProductLocked } from "@/lib/auth/is-organization-product-locked";

export const instant = false;

interface SharedSokoBotLayoutProps {
  children: ReactNode;
}

/** A shared bot's console needs the same seat and messages as one's own. */
export default async function SharedSokoBotLayout({
  children,
}: SharedSokoBotLayoutProps) {
  if (await isOrganizationProductLocked()) {
    return <OrganizationProductSeatRequired />;
  }

  return (
    <ClientMessageBoundary paths={SOKO_BOT_MESSAGE_PATHS}>
      {children}
    </ClientMessageBoundary>
  );
}
