"use client";

import { FolderKanban } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  openProjectScope,
  type ProjectScopeRequest,
} from "./sidebar-project-scope-state";
import { usePrefetchScopeProjects } from "./use-scope-projects";

/**
 * Opens the main project selector, as required, when it mounts: a page that
 * cannot show anything without a project asks for one on arrival. Unmounting
 * (a project chosen, or the reader going elsewhere) closes it again.
 *
 * Esc closes it too, back to the page under it. That page is never broken: it
 * is the empty state that says why it needs a project, with a button to ask
 * again, so closing is always safe and never strands the reader in a modal.
 */
export function RequireProjectScope(
  request: Omit<ProjectScopeRequest, "required">,
) {
  useMountEffect(() => openProjectScope({ ...request, required: true }));
  return null;
}

/** A button that opens the main project selector, as required. */
export function ProjectScopeButton({
  children,
  className,
  request,
}: {
  children: React.ReactNode;
  className?: string;
  request?: Omit<ProjectScopeRequest, "required">;
}) {
  const prefetch = usePrefetchScopeProjects();
  return (
    <Button
      className={className}
      type="button"
      aria-haspopup="dialog"
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onClick={() => openProjectScope({ ...request, required: true })}
    >
      {children}
    </Button>
  );
}

/**
 * What a project-only page (the studio, Ads) shows before it knows which
 * project it is working in: its own copy, and the header's project selector
 * open over it. Choosing there writes the scope back into the URL the way
 * every other scoped page does. The copy is the page's, so it is passed in.
 */
export function ProjectScopeRequired({
  action,
  body,
  testId,
  title,
}: {
  action: string;
  body: string;
  testId: string;
  title: string;
}) {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center py-10 text-center"
      data-testid={testId}
    >
      <RequireProjectScope reason={body} />
      <span
        aria-hidden
        className="bg-background border-border text-muted-foreground flex size-10 items-center justify-center rounded-lg border"
      >
        <FolderKanban className="size-5" />
      </span>
      <h2 className="mt-4 text-base font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {body}
      </p>
      <ProjectScopeButton className="mt-5" request={{ reason: body }}>
        {action}
      </ProjectScopeButton>
    </div>
  );
}

/**
 * The page under a required selector: dimmed, and it takes no clicks. The
 * selector's own modal layer already keeps focus and screen readers inside it.
 * A scrim, not a blur: the brand bans blur (see `src-walk-guards.test.ts`).
 * It sits under the header (z-50), so the selector stays beside its trigger.
 */
export function ProjectScopeBackdrop() {
  return createPortal(
    <div
      aria-hidden
      data-testid="project-scope-backdrop"
      className="bg-scrim fixed inset-0 z-40 motion-safe:animate-in motion-safe:fade-in-0"
    />,
    document.body,
  );
}

/** The line above the list that says what the project is for. */
export function ProjectScopeReason({
  id,
  reason,
}: {
  id: string;
  reason: string;
}) {
  return (
    <p
      id={id}
      className="text-muted-foreground border-border shrink-0 border-b px-3 py-2 text-sm text-pretty"
    >
      {reason}
    </p>
  );
}
