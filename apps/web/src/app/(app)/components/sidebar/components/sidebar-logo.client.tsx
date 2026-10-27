"use client";

import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";

export default function SidebarLogo() {
  return (
    <div className="flex h-8 items-center pl-2">
      <Link href="/" className="hover:opacity-80 transition-opacity">
        <ThemedLogo LogoComponent={SokosumiLogo} height={16} width={123} />
      </Link>
    </div>
  );
}
