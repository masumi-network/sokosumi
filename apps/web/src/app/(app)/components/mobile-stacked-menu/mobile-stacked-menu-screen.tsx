import type { ReactElement, ReactNode } from "react";

/**
 * Full stacked list screen for mobile App Shell intermediate menus.
 * Header back / tab-bar chrome come from App Shell via the route path;
 * this surface only owns title + grouped list body.
 */
export function MobileStackedMenuScreen({
  title,
  children,
  testId = "mobile-stacked-menu-screen",
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}): ReactElement {
  return (
    <div
      className="mx-auto w-full py-6 md:max-w-4xl md:py-8"
      data-testid={testId}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl leading-tight font-semibold">{title}</h1>
        </header>
        <nav aria-label={title} className="space-y-6">
          {children}
        </nav>
      </div>
    </div>
  );
}
