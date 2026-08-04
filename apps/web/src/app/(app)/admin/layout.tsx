import type { ReactNode } from "react";

import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { ADMIN_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { requireAdminSession } from "@/lib/auth/admin-access";

export const instant = false;

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminSession();
  return (
    <ClientMessageBoundary paths={ADMIN_MESSAGE_PATHS}>
      {children}
    </ClientMessageBoundary>
  );
}
