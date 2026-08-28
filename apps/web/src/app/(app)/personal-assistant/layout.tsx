import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { OrganizationProductSeatRequired } from "@/components/billing/organization-product-seat-required";
import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SOKO_BOT_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationProductLocked } from "@/lib/auth/is-organization-product-locked";
import { isBetaAccessEmail } from "@/lib/beta-access";

export const instant = false;

interface SokoBotLayoutProps {
  children: ReactNode;
}

export default async function SokoBotLayout({ children }: SokoBotLayoutProps) {
  // Beta gate, inherited from Hermes: outside the whitelisted email domains
  // the whole route does not exist — the same 404 a made-up path would get, so
  // nothing about the feature leaks before it is opened up.
  const session = await getSession();
  if (!isBetaAccessEmail(session?.user.email)) {
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
