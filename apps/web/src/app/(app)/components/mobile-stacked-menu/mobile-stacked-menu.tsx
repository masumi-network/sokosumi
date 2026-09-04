"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Grouped list primitives matching You’s section language.
 * Reusable for any mobile App Shell stacked menu screen.
 */
export function MobileStackedMenuGroup({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="border-border bg-card-background divide-border divide-y overflow-hidden rounded-lg border">
      {children}
    </div>
  );
}

export function MobileStackedMenuLink({
  href,
  icon,
  label,
  testId,
}: {
  href: string;
  icon: ReactElement;
  label: string;
  testId: string;
}): ReactElement {
  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-between gap-2 rounded-none font-normal md:h-10"
    >
      <Link href={href} data-testid={testId}>
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
      </Link>
    </Button>
  );
}

export function MobileStackedMenuAction({
  icon,
  label,
  testId,
  onClick,
  chevron = true,
}: {
  icon: ReactElement;
  label: string;
  testId: string;
  onClick: () => void;
  chevron?: boolean;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-11 w-full justify-between gap-2 rounded-none font-normal md:h-10"
      data-testid={testId}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {chevron ? (
        <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
      ) : null}
    </Button>
  );
}
