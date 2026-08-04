import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/auth/admin-access";

export const instant = false;

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminSession();
  return children;
}
