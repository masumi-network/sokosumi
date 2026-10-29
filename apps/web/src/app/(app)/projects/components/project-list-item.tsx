import { ProjectListItem as ProjectListItemType } from "@sokosumi/core-client";
import Link from "next/link";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { ProjectCardMenu } from "@/app/projects/components/project-card-menu";
import { ProjectPinButton } from "@/app/projects/components/project-pin-button";
import {
  type ProjectResourceCountPillLabels,
  ProjectResourceCountPills,
} from "@/app/projects/components/project-resource-count-pills";
import {
  PROJECTS_CARD_CLASS,
  PROJECTS_CARD_LAYOUT_CLASS,
} from "@/app/projects/constants";
import { TimeAgo } from "@/components/time-ago";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

import type { ProjectHideLabels } from "./use-project-hide";

interface ProjectListItemLabels {
  counts: ProjectResourceCountPillLabels;
  lastActivity: string;
  created: string;
  pin: string;
  unpin: string;
  pinError: string;
  closed: string;
  moreActions: string;
  hide: ProjectHideLabels;
}

interface ProjectListItemProps {
  project: ProjectListItemType;
  labels: ProjectListItemLabels;
  /** The card sits in the Hidden view: no Pin, and its menu offers Show. */
  hidden?: boolean;
  /** Runs once a Pin or Unpin has landed at Core. */
  onPinnedChange?: () => void;
  /** Runs once a Hide, Show or its Undo has landed at Core. */
  onHiddenChange?: () => void;
}

export function ProjectListItem({
  project,
  labels,
  hidden = false,
  onPinnedChange,
  onHiddenChange,
}: ProjectListItemProps) {
  const briefing = stripMarkdownToText(project.briefing);
  // Core floors lastActivityAt at createdAt (GREATEST(p."createdAt", …)), so
  // an equal pair means nothing has happened in the project yet. Calling that
  // "active" would be a lie, and a bare stamp would be read as one.
  // Exact equality holds because both sides are the same column value at the
  // same precision; if Core ever rounds or recomputes the floor, this silently
  // falls back to the plain activity stamp rather than breaking.
  const isUntouched =
    new Date(project.lastActivityAt).getTime() ===
    new Date(project.createdAt).getTime();
  // Only a finished close counts: closing and close-failed projects stay Open.
  const closedAt = project.closedAt;
  // A Hidden card has no Pin: hiding unpinned it, and Pinning would show it.
  const showPin = !closedAt && !hidden;

  return (
    // The Pin button and the menu cannot live inside the link — a button
    // nested in an anchor is invalid and the click would navigate instead —
    // so the card holds the link and the buttons side by side: the link fills
    // the card, the buttons sit over its top-right corner and keep their own
    // hit areas.
    <article
      className={cn(
        PROJECTS_CARD_LAYOUT_CLASS,
        PROJECTS_CARD_CLASS,
        "group/card hover:bg-card-background-hover relative flex flex-col transition-[background-color]",
        // The link stops short of the Pin button, so its own outline would cut
        // a line through the card. The ring goes around the whole card instead.
        // Forced colors drop box-shadow and the card's paint containment clips
        // the link's outline, so a transparent outline on the card carries
        // focus there; the system colour paints it.
        "has-[>a:focus-visible]:ring-ring has-[>a:focus-visible]:ring-2",
        "has-[>a:focus-visible]:outline-2 has-[>a:focus-visible]:outline-transparent",
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 rounded-lg p-4 outline-hidden",
          "press content-in",
        )}
      >
        {/* Clear of the Pin and menu buttons in the top-right corner. */}
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            showPin ? "pe-18" : "pe-8",
          )}
        >
          <ProjectAvatar name={project.name} logo={project.logo} />
          <span className="text-foreground line-clamp-1 min-w-0 text-sm font-medium">
            {project.name}
          </span>
        </div>

        {briefing ? (
          <p className="text-muted-foreground line-clamp-2 text-sm wrap-anywhere">
            {briefing}
          </p>
        ) : null}

        <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
          <ProjectResourceCountPills
            taskCount={project.taskCount}
            jobCount={project.jobCount}
            labels={labels.counts}
          />
          {closedAt ? (
            <span className="text-muted-foreground ms-auto flex shrink-0 items-center gap-2 text-xs whitespace-nowrap">
              <Badge variant="secondary">{labels.closed}</Badge>
              <TimeAgo date={closedAt} titlePrefix={labels.closed} />
            </span>
          ) : (
            <span className="text-muted-foreground ms-auto shrink-0 text-xs whitespace-nowrap">
              {isUntouched ? `${labels.created} ` : null}
              <TimeAgo
                date={project.lastActivityAt}
                titlePrefix={isUntouched ? labels.created : labels.lastActivity}
              />
            </span>
          )}
        </div>
      </Link>

      {/* A Closed card has no Pin or menu: the Closed view never sorts by a
          Pin, a Closed project lists there Hidden or not, and the project
          header still offers Unpin and Show for what a close left. */}
      {closedAt ? null : (
        // gap-3 keeps the two 44px hit areas from overlapping.
        <div className="absolute end-2 top-2 flex items-center gap-3">
          {showPin ? (
            <ProjectPinButton
              projectId={project.id}
              isPinned={project.starredAt != null}
              isClosed={project.closingAt != null}
              revealOnHover
              onPinnedChange={onPinnedChange}
              labels={{
                pin: labels.pin,
                unpin: labels.unpin,
                error: labels.pinError,
              }}
            />
          ) : null}
          <ProjectCardMenu
            projectId={project.id}
            hidden={hidden}
            onHiddenChange={onHiddenChange}
            labels={{ ...labels.hide, moreActions: labels.moreActions }}
          />
        </div>
      )}
    </article>
  );
}
