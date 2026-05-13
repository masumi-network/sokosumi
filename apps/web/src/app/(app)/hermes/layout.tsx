import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hermesBetaEnabled } from "@/lib/flags/hermes-beta";

interface HermesLayoutProps {
  children: ReactNode;
}

export default async function HermesLayout({ children }: HermesLayoutProps) {
  if (!(await hermesBetaEnabled())) {
    notFound();
  }

  return children;
}
