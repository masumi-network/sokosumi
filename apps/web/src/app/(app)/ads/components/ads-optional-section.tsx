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
  /** The field this section folds, when a step check should be able to reopen it. */
  name?: string;
  children: ReactNode;
}

/**
 * An optional part of the ad: closed until the reader wants it. A refusal for
 * something inside it opens it, whether a submit or a wizard step's check
 * found it, and so does each later submit it still fails; the reader can
 * close it again.
 */
export function AdsOptionalSection({
  title,
  summary,
  invalid,
  children,
}: AdsOptionalSectionProps) {
  const { formState } = useFormContext();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState({
    invalid,
    submits: formState.submitCount,
  });

  if (seen.invalid !== invalid || seen.submits !== formState.submitCount) {
    const refusedNow = invalid && !seen.invalid;
    const resubmitted = seen.submits !== formState.submitCount;
    setSeen({ invalid, submits: formState.submitCount });
    if (invalid && (refusedNow || resubmitted)) setOpen(true);
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
