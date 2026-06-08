import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/auth/admin-access";

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminSession();
  return children;
}
