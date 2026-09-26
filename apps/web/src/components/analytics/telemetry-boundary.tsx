"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { RESET_PASSWORD_PATH } from "@/lib/reset-password-token";

interface TelemetryBoundaryProps {
  children: ReactNode;
}

export function TelemetryBoundary({ children }: TelemetryBoundaryProps) {
  const pathname = usePathname();
  const isResetPasswordPath =
    pathname === RESET_PASSWORD_PATH ||
    pathname.startsWith(`${RESET_PASSWORD_PATH}/`);

  return isResetPasswordPath ? null : children;
}
