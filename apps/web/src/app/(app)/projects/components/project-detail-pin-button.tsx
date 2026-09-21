"use client";

import { ProjectPinButton } from "@/app/projects/components/project-pin-button";
import { usePinnedProjects } from "@/hooks/use-pinned-projects";
import { useSession } from "@/lib/auth/auth.client";

interface ProjectDetailPinButtonProps {
  projectId: string;
  labels: { pin: string; unpin: string };
}

/**
 * The Pin control on a project's own page, so a reader who is already inside a
 * project does not have to go back to the list to Pin it.
 *
 * Unlike a list row, this page has no `starredAt` to read: `GET /projects/{id}`
 * returns the plain project, which deliberately carries no Pin (it would force
 * the question on every route that returns a project and does not care). So the
 * state comes from the reader's Pin list instead — the same cache entry the
 * sidebar flyout uses, which means one fetch serves both and a toggle here
 * updates the sidebar too.
 */
export function ProjectDetailPinButton({
  projectId,
  labels,
}: ProjectDetailPinButtonProps) {
  const { data: session, isPending, isRefetching, error } = useSession();
  const scope =
    session && !isPending && !isRefetching && !error
      ? {
          userId: session.user.id,
          organizationId: session.session.activeOrganizationId ?? null,
        }
      : null;
  const pinned = usePinnedProjects(scope);

  if (!pinned.data) {
    // Holds the space rather than rendering an unpinned button that flips a
    // moment later: a control that lies briefly is worse than one that
    // arrives, and the reserved box keeps the header from shifting.
    return <span aria-hidden className="inline-block size-8" />;
  }

  return (
    <ProjectPinButton
      projectId={projectId}
      isPinned={pinned.data.some((project) => project.id === projectId)}
      labels={labels}
    />
  );
}
