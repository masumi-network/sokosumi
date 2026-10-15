"use client";

import { type ReactNode, useState } from "react";
import { useFormContext } from "react-hook-form";

import { DisclosureContent, DisclosureTrigger } from "@/components/disclosure";
import { Collapsible } from "@/components/ui/collapsible";

interface AdsOptionalSectionProps {
  title: string;
  /** Said next to the title once something is filled in. */
  summary: string | null;
  /** Whether the section holds a refusal. */
  invalid: boolean;
  children: ReactNode;
}

/**
 * An optional part of the ad: closed until the reader wants it. A submit that
 * is refused for something inside it opens it once; the reader can close it
 * again.
 */
export function AdsOptionalSection({
  title,
  summary,
  invalid,
  children,
}: AdsOptionalSectionProps) {
  const { formState } = useFormContext();
  const [open, setOpen] = useState(false);
  const [submits, setSubmits] = useState(formState.submitCount);

  if (submits !== formState.submitCount) {
    setSubmits(formState.submitCount);
    if (invalid) setOpen(true);
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <DisclosureTrigger className="text-sm font-medium">
        {title}
        {summary ? (
          <span className="text-muted-foreground font-normal">{summary}</span>
        ) : null}
      </DisclosureTrigger>
      <DisclosureContent>
        {/* Room around the content for the focus ring that the fold clips. */}
        <div className="-mx-1 px-1 pt-4 pb-1">{children}</div>
      </DisclosureContent>
    </Collapsible>
  );
}
