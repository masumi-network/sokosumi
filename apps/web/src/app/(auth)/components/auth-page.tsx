import type { ReactNode } from "react";

interface AuthPageProps {
  /** `AuthPageHeader`, or Log in's and Register's `AuthHeader`. */
  header: ReactNode;
  /** The body holds a secret, so Sentry Replay masks the page. */
  blockReplay?: boolean;
  children: ReactNode;
}

/** An auth page's column: its header, then the body at the page's gap. */
export function AuthPage({
  header,
  blockReplay = false,
  children,
}: AuthPageProps) {
  return (
    <div
      className="flex flex-1 flex-col"
      data-sentry-block={blockReplay || undefined}
    >
      {header}
      <div className="flex flex-1 flex-col gap-6 p-6 pt-0">{children}</div>
    </div>
  );
}

interface AuthPageHeaderProps {
  title: string;
  description: string;
}

/** A page's title and the line under it. */
export function AuthPageHeader({ title, description }: AuthPageHeaderProps) {
  return (
    <div className="space-y-2 p-6 text-center">
      <h1 className="text-2xl font-light tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
