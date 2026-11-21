"use client";

import { usePathname } from "next/navigation";

import { useProjectScope } from "@/app/components/project-scope/use-project-scope";
import { useRecordPageVisit } from "@/hooks/effects/use-record-page-visit";
import { useWarmLikelyPages } from "@/hooks/effects/use-warm-likely-pages";

/** Counts one visit per page shown; a new pathname remounts it. */
function RecordVisit({ pathname }: { pathname: string }) {
  useRecordPageVisit(pathname);
  return null;
}

/**
 * Keeps the reader's most visited pages loaded while they use the tab, so a
 * click on one opens it with its content even when no hover or approach
 * predicted it.
 */
function WarmLoop({ hrefFor }: { hrefFor: (href: string) => string }) {
  useWarmLikelyPages(hrefFor);
  return null;
}

export function WarmLikelyPages() {
  const pathname = usePathname();
  const { hrefFor } = useProjectScope();
  return (
    <>
      <RecordVisit key={pathname} pathname={pathname} />
      <WarmLoop hrefFor={hrefFor} />
    </>
  );
}
