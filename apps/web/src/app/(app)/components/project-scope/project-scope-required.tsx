"use client";

import { FolderKanban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  openProjectScope,
  openScopeCreate,
  type ProjectScopeRequest,
  setScopeCreateOpen,
} from "./sidebar-project-scope-state";
import { useHasAnyScopeProject } from "./use-scope-projects";

/**
 * Opens the main project selector, as required, when it mounts: an explicit
 * action that needs a project can mount this to ask for one. Unmounting
 * (a project chosen, or the reader going elsewhere) closes it again.
 *
 * Esc closes it too, back to the page under it. That page is never broken: it
 * is the page's own backdrop that says why it needs a project, and the header's
 * selector is still there to pick one, so closing is always safe and never
 * strands the reader in a modal.
 */
export function RequireProjectScope(
  request: Omit<ProjectScopeRequest, "required">,
) {
  useMountEffect(() => openProjectScope({ ...request, required: true }));
  return null;
}

/**
 * What a project-only page (Newsletter, Social, Ads, the studio) shows before
 * it knows which project it is working in: its own backdrop (`children`), its
 * copy, and a Create project button for an empty workspace. The button seeds
 * a required request before opening Create. Choosing or creating writes the
 * scope back into the URL the way every other scoped page does. Navigation
 * opens the header's required selector once an open project is known; explicit
 * actions can opt into opening it on mount before that query has settled.
 */
export function ProjectScopeRequired({
  autoOpen = false,
  body,
  children,
  onSelect,
  testId,
  title,
  variant = "prompt",
}: {
  /**
   * Opt into opening the header's project selector on mount for an explicit
   * action that needs a project, even before project availability is known.
   * Page navigation opens it once the workspace has an open project.
   */
  autoOpen?: boolean;
  body: string;
  /** The page's backdrop; a plain project tile when it has none. */
  children?: React.ReactNode;
  onSelect?: ProjectScopeRequest["onSelect"];
  testId?: string;
  title?: string;
  variant?: "prompt" | "action";
}) {
  const headingId = useId();
  const t = useTranslations("App.ProjectScope");
  const { isPending, hasProjects } = useHasAnyScopeProject();
  const shouldAutoOpen = autoOpen === true || (!isPending && hasProjects);
  const cancelRequest = useRef<ReturnType<typeof openProjectScope> | null>(
    null,
  );

  useMountEffect(() => () => {
    if (cancelRequest.current) {
      cancelRequest.current();
      setScopeCreateOpen(false);
    }
  });

  function handleCreateProject(event: React.MouseEvent<HTMLButtonElement>) {
    cancelRequest.current = openProjectScope({
      required: true,
      reason: body,
      onSelect,
    });
    openScopeCreate(event.currentTarget);
  }

  const Wrapper = variant === "action" ? "div" : "section";

  return (
    <Wrapper
      aria-labelledby={variant === "prompt" && title ? headingId : undefined}
      className={
        variant === "action"
          ? "flex justify-center"
          : "flex w-full min-w-0 flex-col items-center py-10 text-center sm:py-16"
      }
      data-testid={testId}
    >
      {shouldAutoOpen ? (
        <RequireProjectScope reason={body} onSelect={onSelect} />
      ) : null}
      {variant === "prompt" ? (
        <>
          {children ?? (
            <span
              aria-hidden
              className="bg-background border-border text-muted-foreground flex size-10 items-center justify-center rounded-lg border"
            >
              <FolderKanban className="size-5" />
            </span>
          )}
          {title ? (
            <h2
              id={headingId}
              className="mt-8 text-2xl font-light tracking-tight text-balance"
            >
              {title}
            </h2>
          ) : null}
          <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed text-pretty">
            {body}
          </p>
        </>
      ) : null}
      {/* Empty workspaces offer Create in the switcher, so go straight to create. */}
      {!shouldAutoOpen && !isPending && !hasProjects ? (
        <Button
          className={variant === "prompt" ? "mt-6" : undefined}
          data-testid="project-scope-select-button"
          onClick={handleCreateProject}
          type="button"
          variant="primary"
        >
          {t("create")}
        </Button>
      ) : null}
    </Wrapper>
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
