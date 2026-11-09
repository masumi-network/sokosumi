import "./design-system.css";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { isDesignSystemPublic } from "./access";

/**
 * The fixture routes are for local `next dev` and Vercel preview deploys.
 * Vercel production and other production hosts (no VERCEL_ENV) 404; set
 * ENABLE_DESIGN_SYSTEM_FIXTURES=1 to keep them on a self-hosted production build.
 */
export function previewOnly(): void {
  if (
    isDesignSystemPublic({
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    })
  ) {
    return;
  }
  if (process.env.ENABLE_DESIGN_SYSTEM_FIXTURES === "1") return;
  notFound();
}

interface FixtureFrameProps {
  searchParams: Promise<{ theme?: string | string[] }>;
  children: ReactNode;
}

/** `?theme=dark` or `?theme=light` pins the theme on a wrapper. */
export async function FixtureFrame({
  searchParams,
  children,
}: FixtureFrameProps) {
  const { theme } = await searchParams;
  const pinned = theme === "dark" || theme === "light" ? theme : null;
  return (
    <div className={pinned ? `ds-screen theme-scope ${pinned}` : undefined}>
      {children}
    </div>
  );
}
