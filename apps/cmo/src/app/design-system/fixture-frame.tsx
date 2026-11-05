import "./design-system.css";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/** The fixture routes are for local and preview deploys; production has none. */
export function previewOnly(): void {
  if (process.env.VERCEL_ENV === "production") notFound();
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
