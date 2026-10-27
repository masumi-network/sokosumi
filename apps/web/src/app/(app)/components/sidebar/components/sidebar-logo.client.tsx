"use client";

import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

/** The phone sheet's wordmark; on desktop the Workspace switcher holds its place. */
export default function SidebarLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-8 items-center pl-2", className)}>
      <Link href="/" className="hover:opacity-80 transition-opacity">
        <ThemedLogo LogoComponent={SokosumiLogo} height={16} width={123} />
      </Link>
    </div>
  );
}
